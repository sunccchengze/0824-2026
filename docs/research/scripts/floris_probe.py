import numpy as np, time
from floris import FlorisModel
# 项目内存表（florisData.ts FLORIS_PAIR_8MS，间距 632m）
yaw=[-30,-25,-20,-15,-10,-5,0,5,10,15,20,25,30]
p1=[1339.86,1458.96,1561.32,1643.59,1704.2,1741.51,1753.95,1741.51,1704.2,1643.59,1561.32,1458.96,1339.86]
p2=[1010.0,891.85,756.53,643.12,539.06,461.9,436.44,472.31,555.49,660.71,778.04,909.44,1023.43]
fm=FlorisModel("defaults")
fm.set(layout_x=[0.0,632.0],layout_y=[0.0,0.0],wind_speeds=[8.0],wind_directions=[270.0],turbulence_intensities=[0.06])
e1=[];e2=[]
for k,y in enumerate(yaw):
    fm.set_operation(yaw_angles=np.array([[float(y),0.0]]))
    fm.run(); q=fm.get_turbine_powers()[0]/1e3
    e1.append(abs(q[0]-p1[k])/p1[k]*100); e2.append(abs(q[1]-p2[k])/p2[k]*100)
    if y in (-30,0,30): print("yaw%+d  存表(%.1f,%.1f)  v4.6.6(%.1f,%.1f)"%(y,p1[k],p2[k],q[0],q[1]))
print("上游最大误差 %.2f%%  下游最大误差 %.2f%%  下游平均 %.2f%%"%(max(e1),max(e2),sum(e2)/len(e2)))
# 功率曲线锚点
for v,kw in [(6,731.0),(8,1753.95),(10,3417.8),(12,5000.0)]:
    fm.set(layout_x=[0.0],layout_y=[0.0],wind_speeds=[float(v)],wind_directions=[270.0],turbulence_intensities=[0.06])
    fm.reset_operation(); fm.run()
    print("  %2d m/s 存表 %.1f  v4.6.6 %.1f"%(v,kw,fm.get_turbine_powers()[0][0]/1e3))

# ---- 追加：GCH 横偏 vs 本项目 Jensen 近似（第 17 轮 §3.2 复现） ----
def deflection_compare():
    import numpy as np
    from floris import FlorisModel
    D = 126.0
    fm = FlorisModel("defaults")
    fm.set(layout_x=[0.0], layout_y=[0.0], wind_speeds=[8.0],
           wind_directions=[270.0], turbulence_intensities=[0.06])
    Ct = 0.7634
    a = (1 - np.sqrt(1 - Ct)) / 2
    for yaw in (10, 20, 30):
        fm.set_operation(yaw_angles=np.array([[float(yaw)]]))
        for d in (3, 5, 8):
            cs = fm.calculate_cross_plane(downstream_dist=d * D, y_resolution=60, z_resolution=45)
            df = cs.df
            y, z, u = df.x1.values, df.x2.values, df.u.values
            # 逐高度扣除入流剪切后再求亏损质心
            dfc = np.zeros_like(u)
            for zz in np.unique(z):
                m = z == zz
                u0 = u[m].max()
                dfc[m] = np.clip((u0 - u[m]) / max(u0, 1e-6), 0, 1)
            yc = (y * dfc).sum() / dfc.sum()
            jen = 2 * a * (d * D) * np.tan(np.radians(yaw)) * 0.70
            print("yaw%+3d %2dD  GCH %+7.1f m  Jensen %+7.1f m  差 %+6.1f m"
                  % (yaw, d, yc, -jen, yc + jen))

if __name__ == "__main__":
    print("\n--- 横偏对比 ---")
    deflection_compare()
