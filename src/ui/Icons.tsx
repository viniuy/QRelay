import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'back'
  | 'settings'
  | 'send'
  | 'camera'
  | 'folder'
  | 'pause'
  | 'play'
  | 'check'
  | 'merge'
  | 'compress'
  | 'pdfToWord'
  | 'wordToPdf'
  | 'image'
  | 'scan'
  | 'share'
  | 'open'
  | 'key';

interface Props {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color, strokeWidth = 1.8 }: Props) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'back' && <Path d="M15 6l-6 6 6 6" {...s} strokeWidth={2} />}
      {name === 'settings' && (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...s} />
          <Circle cx="16" cy="7" r="2" {...s} />
          <Circle cx="10" cy="17" r="2" {...s} />
        </>
      )}
      {name === 'send' && (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" {...s} />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" {...s} />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" {...s} />
          <Path d="M14 21l7-7M16 14h5v5" {...s} />
        </>
      )}
      {name === 'camera' && (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4z" {...s} />
          <Circle cx="12" cy="13" r="3.5" {...s} />
        </>
      )}
      {name === 'folder' && <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...s} />}
      {name === 'pause' && (
        <>
          <Rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
          <Rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
        </>
      )}
      {name === 'play' && <Path d="M8 5v14l11-7z" fill={color} />}
      {name === 'check' && <Path d="M5 12l4 4 10-10" {...s} strokeWidth={strokeWidth + 0.6} />}
      {name === 'merge' && (
        <>
          <Rect x="3" y="3" width="11" height="13" rx="2" {...s} />
          <Rect x="10" y="8" width="11" height="13" rx="2" {...s} />
        </>
      )}
      {name === 'compress' && <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5" {...s} />}
      {name === 'pdfToWord' && (
        <>
          <Path d="M6 3h8l5 5v13H6z" {...s} />
          <Path d="M14 3v5h5M9 13h6M9 17h6" {...s} />
        </>
      )}
      {name === 'wordToPdf' && (
        <>
          <Path d="M6 3h8l5 5v13H6z" {...s} />
          <Path d="M14 3v5h5M9 12l2 5 1-3 1 3 2-5" {...s} />
        </>
      )}
      {name === 'image' && (
        <>
          <Rect x="3" y="4" width="18" height="16" rx="2" {...s} />
          <Circle cx="9" cy="10" r="2" {...s} />
          <Path d="M21 16l-5-5-9 9" {...s} />
        </>
      )}
      {name === 'scan' && <Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8M12 9v6" {...s} />}
      {name === 'share' && <Path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" {...s} />}
      {name === 'open' && <Path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" {...s} />}
      {name === 'key' && (
        <>
          <Circle cx="8" cy="12" r="4" {...s} />
          <Path d="M12 12h9M18 12v3M15 12v2" {...s} />
        </>
      )}
    </Svg>
  );
}

export function Mark({ size = 22, ink, paper, accent }: { size?: number; ink: string; paper: string; accent: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34">
      <Rect x="1" y="1" width="32" height="32" rx="8" fill={ink} />
      <Rect x="7" y="7" width="8" height="8" rx="1.5" stroke={paper} strokeWidth={2} fill="none" />
      <Rect x="10" y="10" width="2" height="2" fill={paper} />
      <Rect x="19" y="7" width="8" height="8" rx="1.5" stroke={paper} strokeWidth={2} fill="none" />
      <Rect x="22" y="10" width="2" height="2" fill={paper} />
      <Rect x="7" y="19" width="8" height="8" rx="1.5" stroke={paper} strokeWidth={2} fill="none" />
      <Rect x="10" y="22" width="2" height="2" fill={paper} />
      <Path d="M19.5 26.5 27 19M21.5 19H27v5.5" stroke={accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
