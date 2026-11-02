import { Camera } from "../../d3/core/Camera";
import { Vector3 } from "../../maths/Vector3";
import { Vector4 } from "../../maths/Vector4";
import { Viewport } from "../../maths/Viewport";
import { RenderListQueue } from "./RenderListQueue";
import { ISceneRenderManager } from "../DriverDesign/3DRenderPass/ISceneRenderManager";
import { WebBaseRenderNode } from "../RenderModuleData/WebModuleData/3D/WebBaseRenderNode";
import { WebGLRenderContext3D } from "../WebGLDriver/3DRenderPass/WebGLRenderContext3D";
import { DirectionLightCom } from "../../d3/core/light/DirectionLightCom";
import { Shader3D } from "../../RenderEngine/RenderShader/Shader3D";
import { ShaderData } from "../DriverDesign/RenderDevice/ShaderData";
import { SubShader } from "../../RenderEngine/RenderShader/SubShader";
import { PlanarShadowConfig } from "../../d3/core/light/PlanarShadowConfig";
import { WebGLRenderElement3D } from "../WebGLDriver/3DRenderPass/WebGLRenderElement3D";
import { WebGLShaderInstance } from "../WebGLDriver/RenderDevice/WebGLShaderInstance";
import { WebDefineDatas } from "../RenderModuleData/WebModuleData/WebDefineDatas";
import { ShaderPass } from "../../RenderEngine/RenderShader/ShaderPass";
import { RenderClearFlag } from "../../RenderEngine/RenderEnum/RenderClearFlag";
import { Color } from "../../maths/Color";
import { IRenderElement3D } from "../DriverDesign/3DRenderPass/I3DRenderPass";
import { WebGLEngine } from "../WebGLDriver/RenderDevice/WebGLEngine";
import { WebGLShaderData } from "../RenderModuleData/WebModuleData/WebGLShaderData";
import { WebGLInstanceRenderElement3D } from "../WebGLDriver/3DRenderPass/BatchModule/WebGLInstanceRenderElement3D";
import { MeshSprite3DShaderDeclaration } from "../../d3/core/MeshSprite3DShaderDeclaration";
import { RenderState } from "../RenderModuleData/Design/RenderState";
import { BlendFactor } from "../../RenderEngine/RenderEnum/BlendFactor";
import { StencilOperation } from "../../RenderEngine/RenderEnum/StencilOperation";
import { CompareFunction } from "../../RenderEngine/RenderEnum/CompareFunction";
import { RenderPassUtil } from "./RenderPassUtil";
import { LayaGL } from "../../layagl/LayaGL";
import { StatElement } from "../../layagl/StatisticsContext";

/**
 * @internal
 * @en Planar shadow render pass - No modification to original elements
 * @zh 平面阴影渲染通道 - 完全不修改原元素
 *
 * 【方案概述】
 * 直接获取 PlanarShadow shader，手动编译并渲染，不碰原 element 的状态。
 * 相比 v1/v2 方案，此方案完全避免了对原始渲染元素的修改，因此不会造成原始物体变黑等副作用。
 *
 * 【核心技术点】
 * 1. 手动 Shader 编译：通过 ShaderPass.withCompile() 直接编译 PlanarShadow shader
 * 2. Uniform 手动上传：逐批次上传 scene/sprite/camera/material uniform
 * 3. 模板缓冲去重：使用 Stencil Buffer 防止阴影重叠区域被多次绘制
 * 4. 实例化支持：兼容 GPU Instancing 渲染
 * 5. 非 UBO 编译：Maleoon 920 上该 pass 的 uniform block 绑定会导致 draw 报 1282
 *
 * 【Stencil 算法】
 * - 先把 Stencil Buffer 清 0
 * - Stencil Test: NotEqual(1)，只有未绘制过阴影的像素才通过
 * - Stencil Op: Replace，绘制后将该像素标记为 1
 * - 结果：每个像素最多绘制一次阴影，避免重叠区域变暗
 *
 * 【历史】
 * v1: 替换 element 的 subshader → 会污染原始 shader 缓存
 * v2: 临时替换 subshader 后恢复 → 仍有状态污染风险
 * v3 (当前): 完全独立渲染，不修改原对象 → 安全可靠 ✅
 */
export class PlanarShadowRP {
    private _opaqueList: RenderListQueue;
    private _tempLightDir: Vector3 = new Vector3();
    private _planarShader: Shader3D | null = null;
    /** @internal 绘制异常计数（仅用于日志节流） */
    private _psErr: number = 0;
    private _planarSubShader: SubShader | null = null;
    private _planarShaderPass: ShaderPass | null = null;
    private _compileDefine: WebDefineDatas = new WebDefineDatas();
    /** @internal */
    static PLANARSHADOW_LIGHTDIRECTION: number;
    /** @internal */
    static PLANARSHADOW_SHADOWPLANEY: number;
    /** @internal */
    static PLANARSHADOW_SHADOWOFFSET: number;
    /** @internal */
    static PLANARSHADOW_SHADOWCOLOR: number;
    /** @internal */
    static PLANARSHADOW_SHADOWINTENSITY: number;

    /** @internal */
    static __init__(): void {
        PlanarShadowRP.PLANARSHADOW_LIGHTDIRECTION = Shader3D.propertyNameToID("u_LightDirection");
        PlanarShadowRP.PLANARSHADOW_SHADOWPLANEY = Shader3D.propertyNameToID("u_ShadowPlaneY");
        PlanarShadowRP.PLANARSHADOW_SHADOWOFFSET = Shader3D.propertyNameToID("u_ShadowOffset");
        PlanarShadowRP.PLANARSHADOW_SHADOWCOLOR = Shader3D.propertyNameToID("u_ShadowColor");
        PlanarShadowRP.PLANARSHADOW_SHADOWINTENSITY = Shader3D.propertyNameToID("u_ShadowIntensity");
    }

    constructor() {
        this._opaqueList = new RenderListQueue(false);
    }
    /**
     * @en Get shader defines from context for current element
     * @zh 从 context 获取当前 element 的 shader defines
     */
    private _getShaderDefines(context: WebGLRenderContext3D, element: WebGLRenderElement3D): WebDefineDatas {
        const comDef = this._compileDefine;
        comDef.clear();

        const globalShaderDefines = context._getContextShaderDefines();
        globalShaderDefines.cloneTo(comDef);

        if (element.renderShaderData) {
            comDef.addDefineDatas(element.renderShaderData.getDefineData());
        }

        if (element.materialShaderData) {
            comDef.addDefineDatas(element.materialShaderData._defineDatas);
        }

        if (element.owner) {
            const additionShaderData = element.owner.additionShaderData;
            if (additionShaderData.size > 0) {
                for (let [key, value] of additionShaderData.entries()) {
                    comDef.addDefineDatas(value.getDefineData() as WebDefineDatas);
                }
            }
        }

        return comDef;
    }

    /**
     * @en Render a single element with PlanarShadow shader
     * @zh 使用 PlanarShadow shader 渲染单个 element
     *
     * 【实现细节】
     * 1. 合并 context/element/material/sprite 的所有 defines
     * 2. 手动编译 PlanarShadow shader（不影响原 element 的 shader）
     * 3. 依次上传 scene/render/camera/material 各层级 uniform
     * 4. 调用 drawGeometryElement 直接绘制几何（不经过 element._render）
     * 5. 对于实例化元素，先更新 instance data 再绘制
     */
    private _renderElement(context: WebGLRenderContext3D, element: WebGLRenderElement3D): void {
        // ========== 0. 前置检查 ==========
        // 如果还没有获取到 PlanarShadow shader pass，直接返回
        if (!this._planarShaderPass) return;

        // ========== 1. 设置 shader pass 数据 ==========
        // passData 用于在 shader 编译时查找 uniform 映射
        const passData = this._planarShaderPass.moduleData;
        // 先清空，防止上一个 element 的数据残留
        passData.nodeCommonMap = null;
        if (element.owner) {
            // nodeCommonMap 指向物体的通用 uniform 映射表（如 worldMatrix、lightmap 等）
            passData.nodeCommonMap = element.owner._commonUniformMap;
            // additionShaderData 指向物体的附加 shader 数据 key 列表（如 animation、morph 等）
            passData.additionShaderData = element.owner._additionShaderDataKeys;
        } else {
            passData.additionShaderData = null;
        }

        // ========== 2. 获取并合并 shader defines ==========
        // 合并 context/element/material/sprite 的所有宏定义，确保 shader 变体正确
        const comDef = this._getShaderDefines(context, element);
        // 判断是否为 GPU 实例化渲染元素（WebGLInstanceRenderElement3D）
        const isInstanceElement = element instanceof WebGLInstanceRenderElement3D;
        const instElement = isInstanceElement ? element as unknown as WebGLInstanceRenderElement3D : null;

        // ========== 3. 处理实例化渲染（如果是） ==========
        if (isInstanceElement) {
            // 添加实例化宏定义 SHADERDEFINE_GPU_INSTANCE，启用 shader 中的 instancing 分支
            comDef.add(MeshSprite3DShaderDeclaration.SHADERDEFINE_GPU_INSTANCE);
            // 更新实例化数据（收集所有实例的 world matrix、材质参数等）
            instElement._updateInstanceData();
            // 将收集到的实例化数据上传到 GPU vertex buffer
            for (let i = 0; i < element.updateNums; i++) {
                let buffer = element._vertexBuffers[i];
                if (!buffer) break;
                let data = element._updateData[i];
                // orphanStorage: 告诉驱动我们不需要旧数据，可以直接丢弃（优化性能）
                buffer.orphanStorage();
                // 设置实例化数据：buffer, offset, srcOffset, size（字节数）
                // drawCount = 实例数，_updateDataNum[i] = 每个实例的数据量（如矩阵是 4 个 float）
                buffer.setData(data.buffer as ArrayBuffer, 0, 0, instElement.drawCount * instElement._updateDataNum[i] * 4);
            }
        } else {
            // 非实例化：移除 GPU_INSTANCE 宏定义，使用普通渲染路径
            comDef.remove(MeshSprite3DShaderDeclaration.SHADERDEFINE_GPU_INSTANCE);
        }

        // ========== 4. 手动编译 PlanarShadow shader ==========
        // 使用合并后的 defines 编译 shader，不修改原 element 的 shader
        // withCompile(defines, ignoreCache) = 根据 defines 查找或编译 shader
        // 该 pass 在 PlanarShadowShaderInit 里设了 disableUBO（纯 uniform 编译），
        // 规避 Maleoon 920 上 UBO 块绑定导致 draw 报 INVALID_OPERATION 的问题。
        const mrtCount = (context as any)._mrtColorAttachmentCount;
        const shaderIns = this._planarShaderPass.withCompile(comDef, false, mrtCount) as WebGLShaderInstance;

        // 如果 shader 还没编译完成（异步编译中），直接返回，等待下一帧
        if (!shaderIns.complete) {
            // 着色器尚未编译完成：本帧跳过。仅首次告警，避免静默失败无从排查。
            if (this._psErr++ === 0) console.warn("[PlanarShadow] shader not compiled yet, skip frame. mrt=" + mrtCount);
            return;
        }

        // ========== 5. 准备 uniform 上传所需的状态 ==========
        // context.invertY: 是否需要反转 Y 轴（用于纹理坐标、裁剪空间等，不同平台可能不同）
        const forceInvertFace = context.invertY;
        // cameraUpdateMask: 相机更新标记，用于判断 uniform 是否需要重新上传（避免冗余）
        const updateMark = context.cameraUpdateMask;
        // sceneShaderData: 场景级别的 shader 数据（光照参数、雾效、环境光等）
        const sceneShaderData = context.sceneData;
        // cameraShaderData: 相机级别的 shader 数据（VP 矩阵、相机位置、近远裁剪面等）
        const cameraShaderData = context.cameraData;

        // ========== 6. 绑定 shader 到管线 ==========
        // bind(): 将 shader 绑定到 WebGL 上下文，返回是否切换了 shader
        let switchShader = shaderIns.bind();
        // switchUpdateMark: 相机更新标记是否变化，如果变化了，所有依赖相机的 uniform 都需要重传
        let switchUpdateMark = updateMark !== shaderIns._uploadMark;
        // uploadScene: scene 数据是否需要重新上传（指针变化或 updateMark 变化）
        let uploadScene = shaderIns._uploadScene !== sceneShaderData || switchUpdateMark;

        // ========== 7. 上传 Scene 级 Uniform ==========
        if (uploadScene || switchShader) {
            if (sceneShaderData) {
                // 上传场景 uniform：使用 _sceneUniformParamsMap 查找位置，从 sceneShaderData 读取值
                // uploadScene = true 表示强制上传所有 scene uniform，否则只上传变化的
                shaderIns.uploadUniforms(shaderIns._sceneUniformParamsMap, sceneShaderData, uploadScene);
            }
            // 记录已上传的 scene 数据，避免重复上传
            shaderIns._uploadScene = sceneShaderData;
        }

        // ========== 8. 上传 Render/Sprite 级 Uniform ==========
        if (element.renderShaderData) {
            // 判断 render 数据是否需要上传（数据指针变化或 updateMark 变化）
            let uploadSprite3D = shaderIns._uploadRender !== element.renderShaderData || switchUpdateMark;
            if (uploadSprite3D || switchShader) {
                // 上传物体级 uniform（如 world matrix、lightmap uv 等）
                shaderIns.uploadUniforms(shaderIns._spriteUniformParamsMap, element.renderShaderData, uploadSprite3D);
                // 记录已上传的 render 数据
                shaderIns._uploadRender = element.renderShaderData;
            }
        }

        // ========== 9. 上传 Additional Uniform（附加数据） ==========
        if (element.owner) {
            const additionShaderData = element.owner.additionShaderData;
            // 遍历 shader 需要的所有附加 uniform 组（如 animation、morph target 等）
            for (let [key, encoder] of shaderIns._additionUniformParamsMaps) {
                // 获取物体对应的附加 shader 数据
                const additionData = additionShaderData.get(key);
                if (additionData) {
                    // 判断是否需要重新上传
                    let needUpload = shaderIns._additionShaderData.get(key) !== additionData || switchUpdateMark;
                    if (needUpload || switchShader) {
                        // 上传附加 uniform（如骨骼动画矩阵、morph 权重等）
                        shaderIns.uploadUniforms(encoder, additionData as WebGLShaderData, needUpload);
                        // 记录已上传的附加数据
                        shaderIns._additionShaderData.set(key, additionData);
                    }
                }
            }
        }

        // ========== 10. 上传 Camera 级 Uniform ==========
        let uploadCamera = shaderIns._uploadCameraShaderValue !== cameraShaderData || switchUpdateMark;
        if (uploadCamera || switchShader) {
            // 上传相机 uniform（如 viewProjection 矩阵、相机位置、近远裁剪面等）
            cameraShaderData && shaderIns.uploadUniforms(shaderIns._cameraUniformParamsMap, cameraShaderData, uploadCamera);
            // 记录已上传的 camera 数据
            shaderIns._uploadCameraShaderValue = cameraShaderData;
        }

        // ========== 11. 上传 Material 级 Uniform ==========
        // let uploadMaterial = shaderIns._uploadMaterial !== element.materialShaderData || switchShader;
        // // 判断物体是否需要反转面（根据 transform 的 scale 符号，scale.x*scale.y*scale.z < 0 时需要反转）
        // const invertFront = element.owner?.transform ? element.owner.transform._isFrontFaceInvert : false;
        // if (uploadMaterial || switchShader) {
        // 	// 上传材质 uniform（如 baseColor、texture、smoothness、metalness 等）
        // 	// 注意：PlanarShadow shader 实际只使用 shadow 相关的 uniform（u_LightDirection 等），
        // 	// 这里虽然上传了材质 uniform，但 shader 中不会使用，这是为了代码复用和兼容性
        // 	shaderIns.uploadUniforms(shaderIns._materialUniformParamsMap, element.materialShaderData, uploadMaterial);
        // 	// 记录已上传的 material 数据
        // 	shaderIns._uploadMaterial = element.materialShaderData;
        // }

        // ========== 12. 绘制几何 ==========
        // 直接调用 drawGeometryElement，不经过 element._render()
        // 这样可以完全避免影响原 element 的渲染状态（如 shader、材质等）
        // element.geometry 包含顶点缓冲、索引缓冲、绘制模式（如 TRIANGLES）等信息
        try {
            WebGLEngine.instance.getDrawContext().drawGeometryElement(element.geometry);
        } catch (e) {
            if (this._psErr++ < 5) console.error("[PlanarShadow] draw failed:", e);
        }

        // ========== 13. 清理实例化数据（如果是） ==========
        if (isInstanceElement) {
            // 清除临时的实例化数据，释放内存（_updateData 等）
            instElement.clearRenderData();
        }
    }

    /**
     * @en Render planar shadows
     * @zh 渲染平面阴影
     *
     * 【渲染流程】
     * 1. 视锥体裁剪：筛选出需要渲染阴影的物体
     * 2. 延迟着色：只处理不透明物体 (materialRenderQueue <= 2500)
     * 3. 模板清除：将 Stencil Buffer 清零，准备去重
     * 4. 状态设置：混合、深度测试/写入、剔除全部显式设置，不继承上一个元素的状态
     * 5. 绘制阴影：逐个物体使用 PlanarShadow shader 渲染
     * 6. 状态恢复：关闭模板测试与写入，恢复 depthMask
     *
     * 【Stencil 配置】
     * - Func: NotEqual(1) → 只绘制模板值≠1 的像素（未画过阴影的）
     * - Op (zPass): Replace → 绘制成功后将该像素置 1
     * - Write Mask: 0xFF
     */
    render(
        context: WebGLRenderContext3D,
        renderManager: ISceneRenderManager,
        camera: Camera,
        light: DirectionLightCom,
        config: PlanarShadowConfig
    ): void {
        this._opaqueList.clear();

        // 3.4 起 MeshRender / SimpleSkinRender 会被合批（SceneRenderManager 注册了 batch agent），
        // 这些节点只存在于 agent 的私有列表里，baseRenderList 为空。两处都要收集。
        const nodes: WebBaseRenderNode[] = [];
        const baseList = renderManager.baseRenderList as any;
        if (baseList && baseList.elements) {
            for (let i = 0, n = baseList.length; i < n; i++) nodes.push(baseList.elements[i]);
        }
        const agents: Map<number, any> = (renderManager as any).batchAgentList;
        if (agents && agents.forEach) {
            agents.forEach((agent: any) => {
                const l = agent && agent._baseRenderList;
                if (l && l.elements) {
                    for (let i = 0, n = l.length; i < n; i++) nodes.push(l.elements[i]);
                }
            });
        }
        const list = nodes;
        const count = nodes.length;

        const cullInfo = {
            position: camera._transform.position,
            cullingMask: camera.cullingMask,
            staticMask: camera.staticMask,
            boundFrustum: camera.boundFrustum,
            useOcclusionCulling: camera.useOcclusionCulling,
        };

        const boundFrustum = cullInfo.boundFrustum;
        const cullMask = cullInfo.cullingMask;
        const staticMask = cullInfo.staticMask;
        let render: WebBaseRenderNode;
        let canPass: boolean;
        for (let i = 0; i < count; i++) {
            render = list[i];
            canPass = ((1 << render.layer) & cullMask) != 0 && render.renderbitFlag == 0;
            canPass = canPass && (render.staticMask & staticMask) != 0;
            canPass = canPass && render.shadowCullPass();
            if (canPass) {
                if (!cullInfo.useOcclusionCulling || render._needRender(boundFrustum)) {
                    render.distanceForSort = Vector3.distanceSquared(render.bounds._imp.getCenter(), cullInfo.position);
                    let element: IRenderElement3D;
                    const elements = render.renderelements as IRenderElement3D[];
                    for (let j = 0, len = elements.length; j < len; j++) {
                        element = elements[j];
                        if (element.materialRenderQueue <= 2500) {
                            this._opaqueList.addRenderElement(element);
                        }
                    }
                }
            }
        }

        if (this._opaqueList.elements.length === 0) {
            return;
        }

        if (!this._planarShader) {
            this._planarShader = Shader3D.find("PlanarShadow");
            if (this._planarShader) {
                this._planarSubShader = this._planarShader.getSubShaderAt(0);
                this._planarShaderPass = this._planarSubShader._passes[0];
            }
        }

        if (!this._planarShaderPass) {
            return;
        }

        // Viewport.TEMP.set(viewport.x, viewport.y, viewport.width, viewport.height);
        // Vector4.TEMP.setValue(viewport.x, viewport.y, viewport.width, viewport.height);
        // context.setViewPort(Viewport.TEMP);
        // context.setScissor(Vector4.TEMP);
        context.setClearData(RenderClearFlag.Nothing, Color.BLACK, 1, 0);

        if (context._needStart) {
            context._bindRenderTarget();
            context._start();
            context._needStart = false;
        }

        let time = performance.now();

        context._prepareContext();

        let bufferMgr = WebGLEngine.instance.bufferMgr;
        if (bufferMgr) {
            bufferMgr.upload();
        }
        // 清空 stencil，为阴影去重做准备（整个屏幕置 0）
        WebGLEngine.instance.clearRenderTexture(RenderClearFlag.Stencil, null, 1, 0);
		LayaGL.statAgent.recordTimeData(StatElement.T_3DContextPre, performance.now() - time);

        const elements = this._opaqueList.elements.elements;
        const elementCount = this._opaqueList.elements.length;

        this._opaqueList._quickSort.sort(this._opaqueList.elements, false, 0, elementCount - 1);

        const engineRenderState = WebGLEngine.instance._GLRenderState;

        // ========== Stencil 去重 ==========
        // 只绘制 stencil != 1 的像素（还没画过阴影的地方），画完置 1。
        // 同一像素最多画一次阴影，避免重叠区域反复混合变黑。
        engineRenderState.setStencilWrite(true);
        engineRenderState.setStencilWriteMask(0xff);
        engineRenderState.setStencilOp(StencilOperation.Keep, StencilOperation.Keep, StencilOperation.Replace);
        engineRenderState.setStencilTest(true);
        engineRenderState.setStencilFunc(CompareFunction.NotEqual, 1, 0xff);

        // ========== 配置其他渲染状态 ==========
        // 这里必须把状态全部设一遍：本 pass 绕过 element._render，不会执行
        // uploadRenderStateBlendDepth/FrontFace，任何没显式设置的项都继承“上一个绘制元素”的状态。
        // 场景里出现透明面片（如 Atlas3D 的序列帧）后，阴影 pass 前的最后一个元素会从
        // 不透明材质变成 CULL_NONE + depthWrite=false 的透明材质，部分驱动下会直接导致阴影异常。
        engineRenderState.setDepthTest(true);
        engineRenderState.setDepthFunc(CompareFunction.Less);
        engineRenderState.setDepthMask(false);
        engineRenderState.setDepthBias(false);
        // 剔除：背面剔除，与 PlanarShadowShaderInit 中保持一致
        engineRenderState.setCullFace(true);
        engineRenderState.setFrontFace(RenderState.CULL_BACK);
        // 混合：标准 Alpha 混合，阴影颜色与背景颜色混合
        engineRenderState.setBlend(true);
        engineRenderState.setBlendEquation(RenderState.BLENDEQUATION_ADD);
        engineRenderState.setBlendFunc(BlendFactor.SourceAlpha, BlendFactor.OneMinusSourceAlpha);


        time = performance.now();
        for (let i = 0; i < elementCount; i++) {
            const element = elements[i] as WebGLRenderElement3D;
            if (element && element.isRender) {
                this._renderElement(context, element);
            }
        }

        LayaGL.statAgent.recordCTData(StatElement.CT_3DDrawCall, 1);
        LayaGL.renderEngine._framePassCount++;

        // ========== 恢复状态 ==========
        // 关闭模板测试和写入，避免影响后续渲染
        engineRenderState.setStencilTest(false);
        engineRenderState.setStencilWrite(false);
        engineRenderState.setStencilWriteMask(0x00);
        engineRenderState.setDepthMask(true);

        this._opaqueList.clear();
    }

    destroy(): void {
        this._opaqueList.destroy();
    }
}
