import { Color } from "../../../maths/Color";

/**
 * @en Planar shadow configuration
 * @zh 平面阴影配置
 */
export class PlanarShadowConfig {

	/** @internal */
	private _enable: boolean = false;

	/** @internal */
	private _shadowPlaneY: number = 0;

	/** @internal */
	private _shadowColor: Color = new Color(0, 0, 0, 0.5);

	/** @internal */
	private _shadowIntensity: number = 0.7;

	/** @internal */
	private _shadowOffset: number = 0.01;

	/** @internal */
	private _cullingMask: number = 0xFFFFFF;

	/**
	 * @en Enable planar shadow
	 * @zh 启用平面阴影
	 */
	get enable(): boolean {
		return this._enable;
	}

	set enable(value: boolean) {
		this._enable = value;
	}

	/**
	 * @en Shadow plane Y position
	 * @zh 阴影平面Y坐标
	 */
	get shadowPlaneY(): number {
		return this._shadowPlaneY;
	}

	set shadowPlaneY(value: number) {
		this._shadowPlaneY = value;
	}

	/**
	 * @en Shadow color
	 * @zh 阴影颜色
	 */
	get shadowColor(): Color {
		return this._shadowColor;
	}

	set shadowColor(value: Color) {
		value.cloneTo(this._shadowColor);
	}

	/**
	 * @en Shadow intensity (0-1)
	 * @zh 阴影强度 (0-1)
	 */
	get shadowIntensity(): number {
		return this._shadowIntensity;
	}

	set shadowIntensity(value: number) {
		this._shadowIntensity = Math.max(0, Math.min(1, value));
	}

	/**
	 * @en Shadow offset to prevent Z-fighting
	 * @zh 阴影偏移，防止Z-fighting
	 */
	get shadowOffset(): number {
		return this._shadowOffset;
	}

	set shadowOffset(value: number) {
		this._shadowOffset = value;
	}

	constructor() {
	}

}
