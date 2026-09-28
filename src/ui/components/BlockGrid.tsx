import React, { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { OVERSHOOT } from '../motion';
import { usePalette } from '../theme';

interface Props {
  count: number;
  solved: Uint8Array;
}

const ANIMATED_MAX = 120;
const CELLS_MAX = 480;
const ROWS_MAX = 12;

export function BlockGrid({ count, solved }: Props) {
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => layoutFor(count), [count]);
  const cell = width > 0 ? (width - layout.gap * (layout.columns - 1)) / layout.columns : 0;
  const height = layout.rows * cell + (layout.rows - 1) * layout.gap;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: width > 0 ? height : 8 }}>
      {width > 0 && count <= ANIMATED_MAX && (
        <View style={[styles.wrap, { gap: layout.gap }]}>
          {Array.from({ length: count }, (_, i) => (
            <Cell key={i} size={cell} solved={solved[i] === 1} />
          ))}
        </View>
      )}
      {width > 0 && count > ANIMATED_MAX && <PathGrid count={count} layout={layout} cell={cell} solved={solved} width={width} height={height} />}
    </View>
  );
}

interface Layout {
  columns: number;
  rows: number;
  gap: number;
  perCell: number;
  cells: number;
}

function layoutFor(count: number): Layout {
  const perCell = Math.max(1, Math.ceil(count / CELLS_MAX));
  const cells = Math.ceil(count / perCell);
  const columns = cells <= 48 ? 24 : cells <= 120 ? 30 : 40;
  const rows = Math.min(ROWS_MAX, Math.ceil(cells / columns));
  return { columns, rows, gap: cells <= 120 ? 2 : 1, perCell, cells };
}

const Cell = memo(function Cell({ size, solved }: { size: number; solved: boolean }) {
  const c = usePalette();
  const t = useSharedValue(solved ? 1 : 0);
  useEffect(() => {
    if (solved) t.value = withTiming(1, OVERSHOOT);
  }, [solved, t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.7 + 0.3 * t.value }],
    backgroundColor: t.value > 0.5 ? c.lock : c.paper4,
  }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: 1 }, style]} />;
});

function PathGrid({ count, layout, cell, solved, width, height }: Props & { layout: Layout; cell: number; width: number; height: number }) {
  const c = usePalette();
  const { columns, gap, perCell, cells } = layout;
  const pitch = cell + gap;
  const inset = cell * 0.15;
  const small = cell * 0.7;

  const bed = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < cells; i++) {
      const x = (i % columns) * pitch + inset;
      const y = Math.floor(i / columns) * pitch + inset;
      parts.push(`M${x.toFixed(2)} ${y.toFixed(2)}h${small.toFixed(2)}v${small.toFixed(2)}h${(-small).toFixed(2)}z`);
    }
    return parts.join('');
  }, [cells, columns, pitch, inset, small]);

  const fill = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < cells; i++) {
      const start = i * perCell;
      const end = Math.min(count, start + perCell);
      let done = 0;
      for (let b = start; b < end; b++) done += solved[b] ?? 0;
      if (done === 0) continue;
      const frac = done / (end - start);
      const x = (i % columns) * pitch;
      const y = Math.floor(i / columns) * pitch;
      const h = cell * frac;
      parts.push(`M${x.toFixed(2)} ${(y + cell - h).toFixed(2)}h${cell.toFixed(2)}v${h.toFixed(2)}h${(-cell).toFixed(2)}z`);
    }
    return parts.join('');
  }, [solved, cells, perCell, count, columns, pitch, cell]);

  return (
    <Svg width={width} height={height}>
      <Path d={bed} fill={c.paper4} />
      <Path d={fill} fill={c.lock} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
