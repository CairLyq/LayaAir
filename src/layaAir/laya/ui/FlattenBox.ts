import { ILaya } from "../../ILaya";
import { NodeFlags } from "../Const";
import { Node } from "../display/Node";
import { Sprite } from "../display/Sprite";
import { SpriteConst } from "../display/SpriteConst";
import { Point } from "../maths/Point";
import { Rectangle } from "../maths/Rectangle";
import { Context } from "../renders/Context";
import { Box } from "./Box";


const tmpParentWorldPoint = new Point();

function getViewport(node: any): Rectangle {
    return node['_viewport'] || node._style?.viewport;
}

export class FlattenBox extends Box {

    protected _renderChildren: Node[];
    protected _filterChildren: Node[];

    constructor() {
        super();
        this.customRenderEnable = true;
    }

    /**
    * @en Callback when a child node changes.
    * @param child The child node that has changed.
    * @zh 子节点发生变化时的回调。
    * @param child 发生变化的子节点。
    */
    protected _childChanged(child: Node = null): void {
        this.callLater(this._sizeChanged);
        // 不触发绘制子类
        // if (this._children.length) this._renderType |= SpriteConst.CHILDS;
        // else this._renderType &= ~SpriteConst.CHILDS;
        if (child && this._getBit(NodeFlags.HAS_ZORDER)) ILaya.systemTimer.callLater(this, this.updateZOrder);
        this.repaint(SpriteConst.REPAINT_ALL);
    }



    public customRender(context: Context, x: number, y: number): void {
        super.customRender(context, x, y);
        let renderChildren = this._renderChildren;
        if (!renderChildren) {
            return;
        }
        let childs = renderChildren, n = childs.length;
        let drawingToTexture = context._drawingToTexture;

        const root = this;
        function getVisible(node: Sprite): boolean {
            if (node._visible) {
                if (node == root) {
                    return root._visible;
                }
                if (node.parent && (node.parent as Sprite)._visible) {
                    return getVisible(node.parent as Sprite)
                }
            }
            return false
        }

        for (let i = 0; i < n; ++i) {
            let ele = childs[i] as Sprite;
            let parent = ele.parent as Sprite;
            if (!parent) {
                console.warn('parent is null', n, i, ele.name);
                continue;
            };


            let visFlag: boolean;
            if (drawingToTexture)
                visFlag = ele._visible && !ele._getBit(NodeFlags.ESCAPE_DRAWING_TO_TEXTURE);
            else
                visFlag = ele._visible || ele._getBit(NodeFlags.DISABLE_VISIBILITY);

            if (visFlag) {
                visFlag = getVisible(parent);
            }

            if (visFlag) {
                let left: number, top: number, right: number, bottom: number, x2: number, y2: number;
                let rect: Rectangle = getViewport(parent);
                if (rect) {
                    left = rect.x, top = rect.y, right = rect.right, bottom = rect.bottom;
                }

                if (rect && ((x2 = ele._x) >= right || (x2 + ele.width) <= left || (y2 = ele._y) >= bottom || (y2 + ele.height) <= top))
                    visFlag = false;
                else if (this._cacheStyle.mask == ele && !ele._getBit(NodeFlags.DISABLE_VISIBILITY))
                    visFlag = false;
            }

            if (visFlag) {
                if (ele._getBit(NodeFlags.DISABLE_OUTER_CLIPPING))
                    context.clipRect(0, 0, 1, 1, true);

                tmpParentWorldPoint.setTo(0, 0);
                parent.localToGlobal(tmpParentWorldPoint, false);
                let gx = tmpParentWorldPoint.x;
                let gy = tmpParentWorldPoint.y;

                let hasChild = ele._renderType & SpriteConst.CHILDS;
                if (hasChild) ele._renderType &= ~SpriteConst.CHILDS;
                ele.render(context, gx, gy);
                if (hasChild) ele._renderType |= SpriteConst.CHILDS;
            }
        }

        //#region 渲染带滤镜的队列
        childs = this._filterChildren;
        n = childs.length;
        x = x - this.pivotX;
        y = y - this.pivotY;

        let left: number, top: number, right: number, bottom: number, x2: number, y2: number;
        let rect: Rectangle = getViewport(this);
        if (rect) {
            left = rect.x, top = rect.y, right = rect.right, bottom = rect.bottom;
        }

        for (let i = 0; i < n; ++i) {
            let ele = childs[i] as Sprite;
            let visFlag: boolean;
            if (drawingToTexture)
                visFlag = ele._visible && !ele._getBit(NodeFlags.ESCAPE_DRAWING_TO_TEXTURE);
            else
                visFlag = ele._visible || ele._getBit(NodeFlags.DISABLE_VISIBILITY);

            if (visFlag) {
                if (rect && ((x2 = ele._x) >= right || (x2 + ele.width) <= left || (y2 = ele._y) >= bottom || (y2 + ele.height) <= top))
                    visFlag = false;
                else if (this._cacheStyle.mask == ele && !ele._getBit(NodeFlags.DISABLE_VISIBILITY) || drawingToTexture)
                    visFlag = false;
            }

            if (visFlag) {
                if (ele._getBit(NodeFlags.DISABLE_OUTER_CLIPPING))
                    context.clipRect(0, 0, 1, 1, true);

                ele.render(context, x, y);
            }
        }
    }

    public renderCells(cells: Node[]): void {
        // 正常的列表项 展开层级渲染
        // 带滤镜的列表 单独一个渲染队列
        let renderChildren: Node[] = [];
        let childrenCount = cells.length;
        let visualNormalChildren = [];
        let visualFilterChildren = [];
        for (let i = 0; i < childrenCount; i++) {
            let child = cells[i] as Sprite;
            if (child.visible) {
                if (child.filters?.length > 0) {
                    visualFilterChildren.push(child);
                    child.cacheAs = 'bitmap';
                }
                else {
                    //3.1.6
                    child.cacheAs = 'none';
                    visualNormalChildren.push(child);
                }
            }
        }
        //@ts-ignore
        visualNormalChildren.sort((a, b) => a.customRenderOrderKey - b.customRenderOrderKey);
        for (let i = 0, childCount = visualNormalChildren.length; i < childCount; i++) {
            let child = visualNormalChildren[i];
            let flatChildren = this.levelOrderTraversal(child);
            for (let j = 0, len = flatChildren.length; j < len; j++) {
                let c = flatChildren[j];
                //@ts-ignore
                c.__renderName = c.name + "-" + i + "_" + j;
                renderChildren[j * childCount + i] = c;
            }
        }
        this._renderChildren = renderChildren;
        this._filterChildren = visualFilterChildren;
    }

    protected levelOrderTraversal(root: Node): Node[] {
        let nodes: Node[] = [];
        let queue: Node[] = [root];
        while (queue.length > 0) {
            const node = queue.shift();
            nodes.push(node);
            const childCount = node.numChildren;
            if (childCount) {
                let children: Node[] = [];
                for (let i = 0; i < childCount; i++) {
                    children[i] = node.getChildAt(i);
                }
                for (let i = 0; i < queue.length; i++) {
                    children[childCount + i] = queue[i];
                }
                queue = children;
            }
        }
        return nodes;
    }

    destroy(destroyChild?: boolean): void {
        super.destroy(destroyChild);
        this._renderChildren = null
        this._filterChildren = null;
    }
}