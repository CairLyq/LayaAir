import { Event } from "../../events/Event";
import { SkinnedMeshRenderer } from "./SkinnedMeshRenderer";
import { SubMeshRenderElement } from "./render/SubMeshRenderElement";
import { SkinnedMeshSprite3DShaderDeclaration } from "./SkinnedMeshSprite3DShaderDeclaration";
import { Mesh } from "../resource/models/Mesh";
import { Texture2D } from "../../resource/Texture2D";
import { Vector2 } from "../../maths/Vector2";
import { Vector4 } from "../../maths/Vector4";
import { BaseRenderType, IBaseRenderNode, IMeshRenderNode, ISimpleSkinRenderNode } from "../../RenderDriver/RenderModuleData/Design/3D/I3DRenderModuleData";
import { Laya3DRender } from "../RenderObjs/Laya3DRender";
import { RenderContext3D } from "./render/RenderContext3D";
import { SimpleSkinnedMeshSprite3D } from "./SimpleSkinnedMeshSprite3D";
import { LayaGL } from "../../layagl/LayaGL";
import { StatElement } from "../../layagl/StatisticsContext";
import { BaseTexture } from "../../resource/BaseTexture";
import { propertyChangeFlag } from "./render/BaseRender";

export class SimpleSkinnedMeshRenderer extends SkinnedMeshRenderer {
    private _simpleAnimatorTexture: BaseTexture;
    /**@internal */
    _simpleAnimatorParams: Vector4;
    private _simpleAnimatorTextureSize: number;
    /**  x simpleAnimation offset,y simpleFrameOffset*/
    private _simpleAnimatorOffset: Vector2;
    /**
     * @en The number of bones.
     * @zh 骨骼数量
     */
    _bonesNums: number;

    //解决编译bug TODO
    private _ownerSimpleRenderNode: ISimpleSkinRenderNode;

    /**
     * @en The animator texture
     * @zh 动画帧贴图
     */
    get simpleAnimatorTexture(): BaseTexture {
        return this._simpleAnimatorTexture;
    }

    set simpleAnimatorTexture(value: BaseTexture) {
        if (value) {
        this._simpleAnimatorTexture = value;
        this._simpleAnimatorTextureSize = value.width;
        this._baseRenderNode.shaderData.setTexture(SimpleSkinnedMeshSprite3D.SIMPLE_SIMPLEANIMATORTEXTURE, value);
        this._baseRenderNode.shaderData.setNumber(SimpleSkinnedMeshSprite3D.SIMPLE_SIMPLEANIMATORTEXTURESIZE, this._simpleAnimatorTextureSize);
        }
        else {
            this._simpleAnimatorTexture = null;
        }
    }

    /**
     * @internal
     * @en The animator params
     * @zh 设置动画帧数参数
     */
    get simpleAnimatorOffset(): Vector2 {
        return this._simpleAnimatorOffset;
    }

    /**
     * @internal
     */
    set simpleAnimatorOffset(value: Vector2) {
        value.cloneTo(this._simpleAnimatorOffset);
    }


    protected _isISkinRenderNode(): any {
        return null;
    }

    /**
     * @ignore
     * @en Creates an instance of SimpleSkinnedMeshRenderer.
     * @zh 创建一个 SimpleSkinnedMeshRenderer 的实例。
     */
    constructor() {
        super();
        this._simpleAnimatorParams = new Vector4();
        this._simpleAnimatorOffset = new Vector2();
        this._baseRenderNode.shaderData.addDefine(SkinnedMeshSprite3DShaderDeclaration.SHADERDEFINE_SIMPLEBONE);
        this._baseRenderNode.shaderData.addDefine(SkinnedMeshSprite3DShaderDeclaration.SHADERDEFINE_BONE);
        this._baseRenderNode.renderNodeType = BaseRenderType.SimpleSkinRender;
        this._baseRenderNode.shaderData.setVector(SimpleSkinnedMeshSprite3D.SIMPLE_SIMPLEANIMATORPARAMS, new Vector4());
    }

    protected _createBaseRenderNode(): IBaseRenderNode {
        this._ownerSimpleRenderNode = Laya3DRender.Render3DModuleDataFactory.createSimpleSkinRenderNode();
        return this._ownerSimpleRenderNode;
    }

    protected _getcommonUniformMap(): string[] {
        return ["Sprite3D", "SimpleSkinnedMesh"];
    }

    /**
     * @internal
     * @en Leader this renderer follows for the baked-animation frame offset.
     *     A multi-part character (body + clothes) computes params at render time,
     *     so copying the leader's *instantaneous* offset earlier (e.g. onPreRender)
     *     can leave a follower one frame behind. Reading the leader's offset here
     *     guarantees both parts sample the same frame.
     * @zh 帧偏移的跟随源。多部位角色（身体 + 衣服）的 params 是在渲染时刻计算的，
     *     若提前复制一次瞬时值，跟随方会差一帧；此处直接读源的实时偏移即可保证同帧。
     */
    _simpleAnimatorOffsetLeader: SimpleSkinnedMeshRenderer = null;

    /**
     * @en Leader this renderer follows for the baked-animation frame offset.
     * @zh 跟随哪个渲染器的动画帧偏移
     */
    get simpleAnimatorOffsetLeader(): SimpleSkinnedMeshRenderer {
        return this._simpleAnimatorOffsetLeader;
    }

    set simpleAnimatorOffsetLeader(value: SimpleSkinnedMeshRenderer) {
        this._simpleAnimatorOffsetLeader = value;
    }

    protected _computeSkinnedData(): void {
        this._computeAnimatorParamsData();
    }

    /**
     * @perfTag PerformanceDefine.T_SkinBoneUpdate
     * @en Update the render state of the skinned mesh.
     * @param context The 3D render context
     * @zh 更新蒙皮网格的渲染状态。
     * @param context 3D 渲染上下文。
     */
    renderUpdate(context: RenderContext3D): void {
        let t = performance.now();
        super.renderUpdate(context);
        this._computeSkinnedData();
        LayaGL.statAgent.recordTimeData(StatElement.T_SkinBoneUpdate, performance.now() - t);
    }

    /**
     *@internal
     */
    _createRenderElement() {
        let renderelement = new SubMeshRenderElement();
        return renderelement;

    }

    /**
     * @internal
     */
    _computeAnimatorParamsData(): void {
        if (this._simpleAnimatorOffsetLeader && this._simpleAnimatorOffsetLeader !== this) {
            this._simpleAnimatorOffsetLeader._simpleAnimatorOffset.cloneTo(this._simpleAnimatorOffset);
        }
        if (this._cacheMesh) {
            this._simpleAnimatorParams.x = this._simpleAnimatorOffset.x;
            this._simpleAnimatorParams.y = Math.round(this._simpleAnimatorOffset.y) * this._bonesNums * 4;

            this._ownerSimpleRenderNode.setSimpleAnimatorParams(this._simpleAnimatorParams);

            if (this._batchRender) {
                this._batchRender.updateProperty(this, propertyChangeFlag.SimpleSkineParam);
            }
        }
    }

    /**
     * @en Set custom data
     * @param value1 Custom data 1
     * @param value2 Custom data 2
     * @zh 自定义数据
     * @param value1 自定义数据1
     * @param value2 自定义数据1
     */
    setCustomData(value1: number, value2: number = 0) {
        this._simpleAnimatorParams.z = value1;
        this._simpleAnimatorParams.w = value2;
        this._ownerSimpleRenderNode.setSimpleAnimatorParams(this._simpleAnimatorParams);
    }

    /**
    *@internal
    */
    _onMeshChange(value: Mesh): void {
        this._onSkinMeshChange(value);
        if (!value)
            return;
        this._cacheMesh = (<Mesh>value);
        this._setRenderElements();

    }

    /**
     * @internal
     * 克隆到目标
     * @param dest 目标 
     */
    _cloneTo(dest: SimpleSkinnedMeshRenderer): void {
        dest.simpleAnimatorOffset = this.simpleAnimatorOffset;
        dest.simpleAnimatorTexture = this.simpleAnimatorTexture;
        dest._bonesNums = this._bonesNums;
        super._cloneTo(dest);
    }

    /**
     * 删除节点
     */
    protected _onDestroy() {
        if (this._cacheRootBone)
            (!this._cacheRootBone._destroyed) && (this._cacheRootBone.transform.off(Event.TRANSFORM_CHANGED, this, this._onWorldMatNeedChange));
        this._simpleAnimatorTexture = null;
        super._onDestroy();
    }
}