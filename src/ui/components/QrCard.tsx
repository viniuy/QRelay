import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import type { BitMatrix } from '../../core/qr/matrix';
import { matrixToPath } from '../../core/qr/matrix';

interface Props {
  matrix: BitMatrix | null;
  /** Pre-built path for `matrix`, when the caller already has it. */
  path?: string;
  quiet?: number;
  padding?: number;
  radius?: number;
}

/**
 * A white card with a QR inside, sized to the width it is given. Black on
 * white whatever the theme, so any scanner reads it. The frame swaps with no
 * transition on purpose: a crossfade blends modules and breaks scanning.
 */
export const QrCard = memo(function QrCard({ matrix, path, quiet = 2, padding = 12, radius = 8 }: Props) {
  const total = matrix ? matrix.size + quiet * 2 : 1;
  const d = matrix ? (path ?? matrixToPath(matrix, quiet)) : '';
  return (
    <View style={[styles.card, { padding, borderRadius: radius }]}>
      <View style={styles.square}>
        {matrix && (
          <Svg width="100%" height="100%" viewBox={`0 0 ${total} ${total}`} preserveAspectRatio="xMidYMid meet">
            <Rect x={0} y={0} width={total} height={total} fill="#FFFFFF" />
            <Path d={d} fill="#000000" />
          </Svg>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', alignSelf: 'stretch' },
  square: { width: '100%', aspectRatio: 1 },
});
