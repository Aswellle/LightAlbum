/**
 * @file src/components/grid/GridSkeleton.tsx
 * @description 网格加载骨架屏（固定网格与瀑布流共用）
 *
 * P0-2：骨架屏的几何参数与真实网格完全一致（列数 / 单元格尺寸 / 间距），
 * 因此「骨架屏 → 照片」的切换不会发生跳动，启动过程看起来是稳定的。
 */

export function GridSkeleton({
  columns,
  itemSize,
  gap,
  rows = 4,
}: {
  columns:  number
  itemSize: number
  gap:      number
  rows?:    number
}) {
  const count = Math.max(1, columns) * rows
  return (
    <div
      style={{
        display:             'grid',
        gridTemplateColumns: `repeat(${columns}, ${itemSize}px)`,
        gap,
        padding:             gap,
      }}
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width:           itemSize,
            height:          itemSize,
            borderRadius:    4,
            backgroundColor: 'var(--la-bg-overlay)',
            backgroundImage: 'linear-gradient(90deg, var(--la-bg-overlay) 0%, var(--la-bg-hover) 50%, var(--la-bg-overlay) 100%)',
            backgroundSize:  '200% 100%',
            animation:       'la-shimmer 1.5s linear infinite',
            animationDelay:  `${(i * 0.05) % 0.5}s`,
          }}
        />
      ))}
    </div>
  )
}
