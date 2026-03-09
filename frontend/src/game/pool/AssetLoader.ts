// Preloads all pool game image and audio assets.

export interface PoolAssets {
  images: {
    cloth: HTMLImageElement;
    tableTop: HTMLImageElement;
    pockets: HTMLImageElement;
    cue: HTMLImageElement;
    cueShadow: HTMLImageElement;
    shadow: HTMLImageElement;
    shade: HTMLImageElement;
    solidsSpriteSheet: HTMLImageElement;
    ballSpriteSheets: Record<number, HTMLImageElement>; // 9-15
    spotSpriteSheet: HTMLImageElement;
    dottedLine: HTMLImageElement;
    spinSetterLarge: HTMLImageElement;
    cueBallSpot: HTMLImageElement;
    guiSolids: HTMLImageElement;
    guiStripes: HTMLImageElement;
    marker: HTMLImageElement;
    powerBarBG: HTMLImageElement;
    powerBarBase: HTMLImageElement;
    powerBarTop: HTMLImageElement;
    mover: HTMLImageElement;
  };
  audio: {
    ballHit: HTMLAudioElement;
    cueHit: HTMLAudioElement;
    cushionHit: HTMLAudioElement;
    pocketHit: HTMLAudioElement;
    ding: HTMLAudioElement;
    cheer: HTMLAudioElement;
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function loadAudio(src: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.oncanplaythrough = () => resolve(audio);
    audio.onerror = () => reject(new Error(`Failed to load audio: ${src}`));
    audio.src = src;
    audio.load();
  });
}

const IMG = '/pool/img';
const AUD = '/pool/audio';

export async function loadPoolAssets(): Promise<PoolAssets> {
  const [
    cloth, tableTop, pockets, cue, cueShadow, shadow, shade,
    solidsSpriteSheet, spotSpriteSheet, dottedLine,
    spinSetterLarge, cueBallSpot, guiSolids, guiStripes, marker,
    powerBarBG, powerBarBase, powerBarTop,
    mover,
    bs9, bs10, bs11, bs12, bs13, bs14, bs15,
    ballHit, cueHit, cushionHit, pocketHit, ding, cheer,
  ] = await Promise.all([
    loadImage(`${IMG}/cloth.webp`),
    loadImage(`${IMG}/tableTop.webp`),
    loadImage(`${IMG}/pockets.webp`),
    loadImage(`${IMG}/cue.webp`),
    loadImage(`${IMG}/cueShadow.webp`),
    loadImage(`${IMG}/shadow.webp`),
    loadImage(`${IMG}/shade.webp`),
    loadImage(`${IMG}/solidsSpriteSheet.webp`),
    loadImage(`${IMG}/spotSpriteSheet.webp`),
    loadImage(`${IMG}/dottedLine.webp`),
    loadImage(`${IMG}/spinSetterLarge.webp`),
    loadImage(`${IMG}/cueBallSpot.webp`),
    loadImage(`${IMG}/guiSolids.webp`),
    loadImage(`${IMG}/guiStripes.webp`),
    loadImage(`${IMG}/marker.webp`),
    loadImage(`${IMG}/powerBarBG.webp`),
    loadImage(`${IMG}/powerBarBase.webp`),
    loadImage(`${IMG}/powerBarTop.webp`),
    loadImage(`${IMG}/mover.webp`),
    loadImage(`${IMG}/ballSpriteSheet9.webp`),
    loadImage(`${IMG}/ballSpriteSheet10.webp`),
    loadImage(`${IMG}/ballSpriteSheet11.webp`),
    loadImage(`${IMG}/ballSpriteSheet12.webp`),
    loadImage(`${IMG}/ballSpriteSheet13.webp`),
    loadImage(`${IMG}/ballSpriteSheet14.webp`),
    loadImage(`${IMG}/ballSpriteSheet15.webp`),
    loadAudio(`${AUD}/ballHit2.mp3`),
    loadAudio(`${AUD}/cueHit.mp3`),
    loadAudio(`${AUD}/cushionHit.mp3`),
    loadAudio(`${AUD}/pocketHit.mp3`),
    loadAudio(`${AUD}/ding.mp3`),
    loadAudio(`${AUD}/cheer.mp3`),
  ]);

  return {
    images: {
      cloth, tableTop, pockets, cue, cueShadow, shadow, shade,
      solidsSpriteSheet, spotSpriteSheet, dottedLine,
      spinSetterLarge, cueBallSpot, guiSolids, guiStripes, marker,
      powerBarBG, powerBarBase, powerBarTop, mover,
      ballSpriteSheets: { 9: bs9, 10: bs10, 11: bs11, 12: bs12, 13: bs13, 14: bs14, 15: bs15 },
    },
    audio: { ballHit, cueHit, cushionHit, pocketHit, ding, cheer },
  };
}
