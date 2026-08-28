#!/usr/bin/env python3
"""A/B 帧差分析：on(风况粒子开) vs off(noveil) —— 量化粒子在画面中的可见性与分布"""
import sys
from PIL import Image
import numpy as np

def analyze(on_path, off_path, label):
    a = np.asarray(Image.open(on_path).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(off_path).convert('RGB'), dtype=np.int16)
    d = np.abs(a - b).sum(axis=2)  # 每像素 RGB 差绝对值之和
    mask = d > 60  # 显著差异像素 = 粒子（其余场景完全一致）
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    print(f'== {label} ==')
    print(f'  粒子显著像素数: {mask.sum()}  ({100*mask.sum()/(w*h):.3f}% of {w}x{h})')
    if len(ys) == 0:
        print('  !! 无粒子可见 — 风层不可见')
        return
    # 垂直分布：按画面 10 条横带统计
    bands = [int(((ys >= h*i/10) & (ys < h*(i+1)/10)).sum()) for i in range(10)]
    print('  垂直分布(上→下,每10%画面高):', bands)
    # 水平分布：10 条竖带
    bandsx = [int(((xs >= w*i/10) & (xs < w*(i+1)/10)).sum()) for i in range(10)]
    print('  水平分布(左→右,每10%画面宽):', bandsx)
    # 亮度检查：粒子像素在 on 帧中的亮度（应偏亮，additive 叠加）
    lum = (a[ys, xs, 0]*0.3 + a[ys, xs, 1]*0.59 + a[ys, xs, 2]*0.11)
    print(f'  粒子亮度 P50={np.percentile(lum,50):.0f} P90={np.percentile(lum,90):.0f} (0-255)')

if __name__ == '__main__':
    analyze(sys.argv[1], sys.argv[2], sys.argv[3])
