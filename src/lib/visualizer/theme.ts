export type RGB = readonly [number, number, number];

export type ThemeId = "pink" | "purple" | "blue" | "green";
export type VizMode = "bars" | "disc" | "orbit";
export type PlateId = (typeof PLATES)[number]["id"];

export type Channel = {
  id: ThemeId;
  label: string;
  rgb: RGB;
  dx: number;
  dy: number;
  swatch: string;
};

export const CHANNELS: readonly Channel[] = [
  { id: "pink", label: "Pink", rgb: [255, 107, 181], dx: -6, dy: 0, swatch: "bg-holo-pink" },
  { id: "purple", label: "Purple", rgb: [176, 107, 255], dx: 5, dy: 2, swatch: "bg-holo-purple" },
  { id: "blue", label: "Blue", rgb: [91, 140, 255], dx: -2, dy: -4, swatch: "bg-holo-blue" },
  { id: "green", label: "Green", rgb: [62, 224, 160], dx: 7, dy: 1, swatch: "bg-holo-green" },
];

export const MODES: readonly { id: VizMode; label: string }[] = [
  { id: "bars", label: "Bars" },
  { id: "disc", label: "Disc" },
  { id: "orbit", label: "Orbit" },
];

export const PLATES = [
  { id: "woods", label: "Woods", src: "/plates/woods.jpg", alt: "Figure on a forest path" },
  { id: "blanket", label: "Blanket", src: "/plates/blanket.jpg", alt: "Cat lying on a blue blanket" },
  { id: "close", label: "Close", src: "/plates/close.jpg", alt: "Close-up of a cat" },
  { id: "proofs", label: "Proofs", src: "/plates/proofs.jpg", alt: "Sheet of portrait photos" },
] as const;

export function channel(id: ThemeId): Channel {
  return CHANNELS.find((item) => item.id === id) ?? CHANNELS[0];
}

export function rgb(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
