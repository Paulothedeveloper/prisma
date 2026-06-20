// Ícones monoline no estilo SF Symbols (traço 1.6, cantos arredondados).
// Não é a fonte SF Symbols (proprietária) — são redesenhos próprios no mesmo espírito.
import type { ReactNode } from "react";

const S = ({ children, size = 17 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export type IconName =
  | "all"
  | "dup"
  | "folder"
  | "image"
  | "video"
  | "gif"
  | "audio"
  | "lut"
  | "font"
  | "document"
  | "unknown"
  | "search"
  | "close"
  | "chevronRight"
  | "chevronUpDown"
  | "play"
  | "sliders"
  | "reveal"
  | "copy"
  | "tag"
  | "star"
  | "starFill"
  | "check"
  | "chevronLeft"
  | "grip"
  | "stack"
  | "plus"
  | "trash"
  | "pencil"
  | "eye"
  | "eyeOff"
  | "shuffle"
  | "tagSlash"
  | "inbox"
  | "pause"
  | "frameBack"
  | "frameFwd"
  | "loop"
  | "volume"
  | "volumeOff"
  | "fullscreen"
  | "refresh"
  | "more"
  | "layoutGrid"
  | "layoutList"
  | "layoutWaterfall"
  | "motionsilk"
  | "contrast"
  | "moon"
  | "sun"
  | "flame"
  | "snowflake"
  | "sparkles";

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  switch (name) {
    case "all":
      return (
        <S size={size}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
        </S>
      );
    case "dup":
      return (
        <S size={size}>
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
          <path d="M15.5 5.5H6.5A2 2 0 0 0 4.5 7.5v9" />
        </S>
      );
    case "folder":
      return (
        <S size={size}>
          <path d="M3.5 7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6l1 1a2 2 0 0 0 1.4.6h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />
        </S>
      );
    case "image":
      return (
        <S size={size}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
        </S>
      );
    case "video":
      return (
        <S size={size}>
          <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
          <path d="M15.5 10.5l5-3v9l-5-3z" />
        </S>
      );
    case "gif":
      return (
        <S size={size}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M14.5 12l-4-2.5v5z" fill="currentColor" stroke="none" />
        </S>
      );
    case "audio":
      return (
        <S size={size}>
          <path d="M9 17.5V6l9-2v9.5" />
          <circle cx="6.5" cy="17.5" r="2.5" />
          <circle cx="15.5" cy="15.5" r="2.5" />
        </S>
      );
    case "lut":
      return (
        <S size={size}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="9" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
        </S>
      );
    case "contrast": // Preto & Branco
      return (
        <S size={size}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
        </S>
      );
    case "moon": // Escuros / Moody
      return (
        <S size={size}>
          <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5 8.5 8.5 0 1 0 20.5 14.3z" />
        </S>
      );
    case "sun": // Claros / Clean
      return (
        <S size={size}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
        </S>
      );
    case "flame": // Tons quentes
      return (
        <S size={size}>
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </S>
      );
    case "snowflake": // Tons frios
      return (
        <S size={size}>
          <path d="M12 2v20M20.66 7 3.34 17M3.34 7l17.32 10M12 6l-2.5-2M12 6l2.5-2M12 18l-2.5 2M12 18l2.5 2M5.5 9 4.7 6.1M5.5 9 2.6 9.8M18.5 15l.8 2.9M18.5 15l2.9-.8M5.5 15l-2.9-.8M5.5 15l-.8 2.9M18.5 9l.8-2.9M18.5 9l2.9.8" />
        </S>
      );
    case "sparkles": // 4K e acima (qualidade/nitidez)
      return (
        <S size={size}>
          <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
          <path d="M19 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </S>
      );
    case "font":
      return (
        <S size={size}>
          <path d="M6 19l5-13 5 13" />
          <path d="M8 14h6" />
        </S>
      );
    case "document":
      return (
        <S size={size}>
          <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
          <path d="M13.5 3.5V8h4.5" />
        </S>
      );
    case "unknown":
      return (
        <S size={size}>
          <path d="M7 3.5h6.5L18 8v11.5A1 1 0 0 1 17 20.5H7A1 1 0 0 1 6 19.5V4.5A1 1 0 0 1 7 3.5z" />
          <path d="M13 3.5V8h4.5" />
        </S>
      );
    case "search":
      return (
        <S size={size}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l4.5 4.5" />
        </S>
      );
    case "close":
      return (
        <S size={size}>
          <path d="M6 6l12 12M18 6L6 18" />
        </S>
      );
    case "chevronRight":
      return (
        <S size={size}>
          <path d="M9 5l7 7-7 7" />
        </S>
      );
    case "chevronUpDown":
      return (
        <S size={size}>
          <path d="M8 10l4-4 4 4M8 14l4 4 4-4" />
        </S>
      );
    case "play":
      return (
        <S size={size}>
          <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
        </S>
      );
    case "sliders":
      return (
        <S size={size}>
          <path d="M5 8h9M18 8h1M5 16h1M10 16h9" />
          <circle cx="16" cy="8" r="2" />
          <circle cx="8" cy="16" r="2" />
        </S>
      );
    case "reveal":
      return (
        <S size={size}>
          <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M12 11v5M9.5 13.5L12 16l2.5-2.5" />
        </S>
      );
    case "copy":
      return (
        <S size={size}>
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
          <path d="M15.5 5.5H6.5A2 2 0 0 0 4.5 7.5v9" />
        </S>
      );
    case "tag":
      return (
        <S size={size}>
          <path d="M4 4h7l9 9-7 7-9-9z" />
          <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
        </S>
      );
    case "star":
      return (
        <S size={size}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
        </S>
      );
    case "starFill":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
        </svg>
      );
    case "check":
      return (
        <S size={size}>
          <path d="M5 12.5l4.5 4.5L19 6.5" />
        </S>
      );
    case "chevronLeft":
      return (
        <S size={size}>
          <path d="M15 5l-7 7 7 7" />
        </S>
      );
    case "grip":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      );
    case "stack":
      return (
        <S size={size}>
          <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
          <path d="M3.5 12l8.5 4.5 8.5-4.5" />
          <path d="M3.5 16l8.5 4.5 8.5-4.5" />
        </S>
      );
    case "plus":
      return (
        <S size={size}>
          <path d="M12 5v14M5 12h14" />
        </S>
      );
    case "trash":
      return (
        <S size={size}>
          <path d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 11a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18.5 7" />
        </S>
      );
    case "pencil":
      return (
        <S size={size}>
          <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" />
          <path d="M14 6l3 3" />
        </S>
      );
    case "eye":
      return (
        <S size={size}>
          <path d="M2.5 12s3.4-6.5 9.5-6.5S21.5 12 21.5 12 18.1 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </S>
      );
    case "eyeOff":
      return (
        <S size={size}>
          <path d="M10.7 5.6A8.5 8.5 0 0 1 12 5.5c6.1 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.3 3.1M6.3 7.1A15 15 0 0 0 2.5 12s3.4 6.5 9.5 6.5a8.4 8.4 0 0 0 3.4-.7" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="M3.5 3.5l17 17" />
        </S>
      );
    case "shuffle":
      return (
        <S size={size}>
          <path d="M3 7h3.5l9 10H20M3 17h3.5l3-3.3M14 7h6M14 17h6" />
          <path d="M17 4l3 3-3 3M17 14l3 3-3 3" />
        </S>
      );
    case "tagSlash":
      return (
        <S size={size}>
          <path d="M4 4h7l9 9-7 7-9-9z" />
          <path d="M3 3l18 18" />
        </S>
      );
    case "inbox":
      return (
        <S size={size}>
          <path d="M3.5 13.5 6 6a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 6l2.5 7.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />
          <path d="M3.5 13.5H8a1 1 0 0 1 1 1 1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15 14.5a1 1 0 0 1 1-1h4.5" />
        </S>
      );
    case "pause":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1.2" />
          <rect x="14" y="5" width="4" height="14" rx="1.2" />
        </svg>
      );
    case "frameBack":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="5" width="2.4" height="14" rx="1" />
          <path d="M20 5L9 12l11 7z" />
        </svg>
      );
    case "frameFwd":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <rect x="17.6" y="5" width="2.4" height="14" rx="1" />
          <path d="M4 5l11 7-11 7z" />
        </svg>
      );
    case "loop":
      return (
        <S size={size}>
          <path d="M4 11V9a3 3 0 0 1 3-3h11M20 13v2a3 3 0 0 1-3 3H6" />
          <path d="M15 3l3 3-3 3M9 21l-3-3 3-3" />
        </S>
      );
    case "volume":
      return (
        <S size={size}>
          <path d="M4 9.5h3l5-4v13l-5-4H4z" />
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" />
        </S>
      );
    case "volumeOff":
      return (
        <S size={size}>
          <path d="M4 9.5h3l5-4v13l-5-4H4z" />
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        </S>
      );
    case "fullscreen":
      return (
        <S size={size}>
          <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
        </S>
      );
    case "refresh":
      return (
        <S size={size}>
          <path d="M20 11a8 8 0 0 0-14-4.5L4 8M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14 4.5L20 16M20 20v-4h-4" />
        </S>
      );
    case "more":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      );
    case "layoutGrid":
      return (
        <S size={size}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </S>
      );
    case "layoutList":
      return (
        <S size={size}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </S>
      );
    case "layoutWaterfall":
      return (
        <S size={size}>
          <rect x="4" y="4" width="7" height="9" rx="1.5" />
          <rect x="13" y="4" width="7" height="5" rx="1.5" />
          <rect x="4" y="15" width="7" height="5" rx="1.5" />
          <rect x="13" y="11" width="7" height="9" rx="1.5" />
        </S>
      );
    case "motionsilk":
      // MotionSilk: ondas de "seda" fluindo + eixo estável no centro
      return (
        <S size={size}>
          <path d="M3 8c4-3.5 7 3.5 9 0s5-3.5 9 0" />
          <path d="M3 16c4-3.5 7 3.5 9 0s5-3.5 9 0" opacity="0.6" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </S>
      );
  }
}
