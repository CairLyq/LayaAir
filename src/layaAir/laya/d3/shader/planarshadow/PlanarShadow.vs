#define SHADER_NAME PlanarShadowVS

#include "Math.glsl";

#include "Scene.glsl";

#include "Camera.glsl";
#include "Sprite3DVertex.glsl";

#include "VertexCommon.glsl";

// u_DirLightDirection 已在 Scene.glsl 声明（单光源模式下作为场景 UBO 成员）

void main() {
    // 只读位置属性：阴影只需要顶点位置。
    // 不要再走 getVertexParams 读 normal/tangent/uv 等，属性越多，
    // 部分驱动（Maleoon 920）在 draw 时的顶点属性校验越容易失败。
    mat4 worldMat = getWorldMatrix();
    vec4 pos = (worldMat * vec4(a_Position.xyz, 1.0));
    vec3 positionWS = pos.xyz / pos.w;

        // 地表法线
    vec4 planeNor = vec4(0.0, 1.0, 0.0, 0.001);

        // 灯光方向
    vec3 L = u_DirLightDirection;
    vec3 N = planeNor.xyz;
    float d1 = dot(L, N);
    float d2 = dot(positionWS, N);

        // 投影世界坐标并转换到裁剪空间
    vec3 shadowPosWS = positionWS + -L * (d2 / d1) + N * planeNor.w;
    gl_Position = remapPositionZ(getPositionCS(shadowPosWS));
}
