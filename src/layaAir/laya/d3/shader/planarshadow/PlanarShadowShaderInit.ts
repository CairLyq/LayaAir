import PlanarShadowVS from "./PlanarShadow.vs";
import PlanarShadowFS from "./PlanarShadow.fs";
import { Shader3D, ShaderFeatureType } from "../../../RenderEngine/RenderShader/Shader3D";
import { SubShader } from "../../../RenderEngine/RenderShader/SubShader";
import { ShaderDataType } from "../../../RenderDriver/DriverDesign/RenderDevice/ShaderData";
import { RenderState } from "../../../RenderDriver/RenderModuleData/Design/RenderState";
import { PlanarShadowRP } from "../../../RenderDriver/DriverCommon/PlanarShadowRP";
import { Vector3 } from "../../../maths/Vector3";

/**
 * @en Planar shadow shader initialization
 * @zh 平面阴影着色器初始化
 *
 * 【功能】
 * 注册名为 "PlanarShadow" 的 shader，包含完整的渲染状态配置。
 * 此 shader 用于将物体顶点沿光照方向投影到地面平面，生成阴影。
 *
 * 【Shader 变量】
 * - u_LightDirection: 平行光方向（世界空间）
 * - u_ShadowPlaneY: 阴影平面 Y 坐标
 * - u_ShadowOffset: 阴影偏移量，用于防止 Z-fighting
 * - u_ShadowColor: 阴影颜色
 * - u_ShadowIntensity: 阴影强度（0-1）
 *
 * 【渲染状态配置】
 * - 混合: SrcAlpha + OneMinusSrcAlpha → 标准 alpha 混合
 * - 深度: 写入关闭，测试开启（LEQUAL） → 只绘制可见的阴影
 * - 剔除: 背面剔除 → 优化性能
 * - 模板: NotEqual(1), Replace → 防止阴影重叠
 *
 * 【与 PlanarShadowRP 的关系】
 * - Shader 定义在此处，由 PlanarShadowRP 在运行时动态编译使用
 * - Stencil 配置在 Shader 和 PlanarShadowRP 中都有，保持同步一致
 * - PlanarShadowRP.__init__() 初始化 uniform property ID 映射
 */
export class PlanarShadowShaderInit {
    static init() {
        // 定义 PlanarShadow shader 所需的 uniform 变量
        let uniformMap = {
            u_LightDirection: ShaderDataType.Vector3,
            u_ShadowPlaneY: ShaderDataType.Float,
            u_ShadowOffset: ShaderDataType.Float,
            u_ShadowColor: ShaderDataType.Color,
            u_ShadowIntensity: ShaderDataType.Float,
        };

        // 注册 shader（名称 "PlanarShadow"）
        let shader = Shader3D.add("PlanarShadow", true, false);
        shader.shaderType = ShaderFeatureType.D3;

        // 创建 subshader，使用默认 attribute map
        let subShader = new SubShader(SubShader.DefaultAttributeMap, uniformMap, {});
        shader.addSubShader(subShader);

        // 添加 shader pass，连接顶点着色器和片段着色器
        let shaderPass = subShader.addShaderPass(PlanarShadowVS, PlanarShadowFS, "PlanarShadow");

        // ========== 配置渲染状态 ==========
        // statefirst = true: 使用 shader 自身的 render state，而非材质的
        shaderPass.statefirst = true;
        // 强制纯 uniform 编译：Maleoon 920 上 UBO 块绑定会让 draw 报 INVALID_OPERATION(1282)
        shaderPass.disableUBO = true;
        let renderState = shaderPass.renderState;

        // 混合启用：SrcAlpha * color + (1-SrcAlpha) * dstColor
        renderState.blend = RenderState.BLEND_ENABLE_ALL;
        renderState.srcBlend = RenderState.BLENDPARAM_SRC_ALPHA;
        renderState.dstBlend = RenderState.BLENDPARAM_ONE_MINUS_SRC_ALPHA;

        // 深度：关闭写入，保留测试（只绘制被遮挡物前面的阴影）
        renderState.depthWrite = false;
        renderState.depthTest = RenderState.DEPTHTEST_LESS;

        // 背面剔除：避免物体自遮挡造成的阴影问题
        renderState.cull = RenderState.CULL_BACK;

        // ========== 阴影蒙板（Stencil）配置 ==========
        // 核心功能：防止同一像素被多次绘制阴影导致重叠变暗
        // - Ref = 1: 模板参考值为 1
        // - Test = NotEqual: 只绘制 stencil != 1 的像素
        // - Write = true: 允许写入 stencil buffer
        // - Op = (Keep, Keep, Replace): 深度测试通过后，将 stencil 设为 1
        renderState.stencilRef = 1;
        renderState.stencilTest = RenderState.STENCILTEST_NOTEQUAL;
        renderState.stencilWrite = true;
        renderState.stencilOp = new Vector3(RenderState.STENCILOP_KEEP, RenderState.STENCILOP_KEEP, RenderState.STENCILOP_REPLACE);

        // 初始化 PlanarShadowRP 的 uniform property ID
        PlanarShadowRP.__init__();
    }
}
