export const DEFAULT_THEME_COLOR = "#123d31";
export const THEME_COLOR_STORAGE_KEY = "unimailbox.theme-color";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

export function normalizeThemeColor(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}

export function resolveInitialThemeColor(value: string | null): string {
  return normalizeThemeColor(value) ?? DEFAULT_THEME_COLOR;
}

function hexToHsl(color: string): HslColor {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hue,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function hslToHex({ hue, saturation, lightness }: HslColor): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
  const offset = l - chroma / 2;
  const [red, green, blue] =
    segment < 1
      ? [chroma, intermediate, 0]
      : segment < 2
        ? [intermediate, chroma, 0]
        : segment < 3
          ? [0, chroma, intermediate]
          : segment < 4
            ? [0, intermediate, chroma]
            : segment < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function themePalette(themeColor: string) {
  const normalized = resolveInitialThemeColor(themeColor);
  const { hue, saturation, lightness } = hexToHsl(normalized);
  const chroma = saturation < 8 ? 0 : Math.min(75, Math.max(45, saturation));

  return {
    themeColor: normalized,
    forest: hslToHex({
      hue,
      saturation: chroma,
      lightness: Math.min(29, lightness),
    }),
    forestDeep: hslToHex({
      hue,
      saturation: chroma,
      lightness: Math.max(8, Math.min(18, lightness * 0.72)),
    }),
    mint: hslToHex({ hue, saturation: chroma, lightness: 82 }),
    focus: hslToHex({
      hue,
      saturation: chroma,
      lightness: Math.max(34, Math.min(46, lightness)),
    }),
    focusSoft: hslToHex({ hue, saturation: chroma, lightness: 88 }),
  };
}

export function applyThemeColor(
  themeColor: string,
  root: HTMLElement = document.documentElement,
): string {
  const palette = themePalette(themeColor);
  root.style.setProperty("--theme-color", palette.themeColor);
  root.style.setProperty("--forest", palette.forest);
  root.style.setProperty("--forest-deep", palette.forestDeep);
  root.style.setProperty("--mint", palette.mint);
  root.style.setProperty("--theme-focus", palette.focus);
  root.style.setProperty("--theme-focus-soft", palette.focusSoft);
  root.style.setProperty("--primary", palette.forest);
  root.style.setProperty("--primary-foreground", "#ffffff");
  root.style.setProperty("--accent", palette.mint);
  root.style.setProperty("--accent-foreground", palette.forestDeep);
  root.style.setProperty("--ring", palette.focus);
  root.ownerDocument
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", palette.forestDeep);
  return palette.themeColor;
}

export function initializeThemeColor(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): string {
  return applyThemeColor(
    resolveInitialThemeColor(storage.getItem(THEME_COLOR_STORAGE_KEY)),
  );
}
