#if !defined(SceneCommon_lib)
    #define SceneCommon_lib

    #ifdef ENUNIFORMBLOCK
uniform Scene3D
{
    // time
    float u_Time;
    vec4 u_FogParams;// x start,y range,z Density
    vec4 u_FogColor;
    float u_GIRotate;
    int u_DirationLightCount;
    // 单光源模式下的主平行光方向：必须属于场景块，否则 UBO 模式下
    // 独立声明的 uniform 永远拿不到值（自定义 shader 读到 0）。
    // 顺序必须与 legacyLightingValueInit() 的注册顺序一致（它排在 shaderValueInit 之后）。
    vec3 u_DirLightDirection;
};
    #else // ENUNIFORMBLOCK
// time
uniform float u_Time;
uniform vec4 u_FogParams;//x start,y range,z Density
uniform vec4 u_FogColor;
uniform float u_GIRotate;
uniform mediump int u_DirationLightCount;
uniform vec3 u_DirLightDirection;
    #endif // ENUNIFORMBLOCK
    //rotate SH IBL

#endif // SceneCommon_lib