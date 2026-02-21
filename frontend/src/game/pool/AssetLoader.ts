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
    bs9, bs10, bs11, bs12, bs13, bs14, bs15,
    ballHit, cueHit, cushionHit, pocketHit, ding, cheer,
  ] = await Promise.all([
    loadImage(`${IMG}/cloth.png`),
    loadImage(`${IMG}/tableTop.png`),
    loadImage(`${IMG}/pockets.png`),
    loadImage(`${IMG}/cue.png`),
    loadImage(`${IMG}/cueShadow.png`),
    loadImage(`${IMG}/shadow.png`),
    loadImage(`${IMG}/shade.png`),
    loadImage(`${IMG}/solidsSpriteSheet.png`),
    loadImage(`${IMG}/spotSpriteSheet.png`),
    loadImage(`${IMG}/dottedLine.png`),
    loadImage(`${IMG}/spinSetterLarge.png`),
    loadImage(`${IMG}/cueBallSpot.png`),
    loadImage(`${IMG}/guiSolids.png`),
    loadImage(`${IMG}/guiStripes.png`),
    loadImage(`${IMG}/marker.png`),
    loadImage(`${IMG}/ballSpriteSheet9.png`),
    loadImage(`${IMG}/ballSpriteSheet10.png`),
    loadImage(`${IMG}/ballSpriteSheet11.png`),
    loadImage(`${IMG}/ballSpriteSheet12.png`),
    loadImage(`${IMG}/ballSpriteSheet13.png`),
    loadImage(`${IMG}/ballSpriteSheet14.png`),
    loadImage(`${IMG}/ballSpriteSheet15.png`),
    loadAudio(`${AUD}/ballHit2.wav`),
    loadAudio(`${AUD}/cueHit.wav`),
    loadAudio(`${AUD}/cushionHit.wav`),
    loadAudio(`${AUD}/pocketHit.wav`),
    loadAudio(`${AUD}/ding.wav`),
    loadAudio(`${AUD}/cheer.wav`),
  ]);

  return {
    images: {
      cloth, tableTop, pockets, cue, cueShadow, shadow, shade,
      solidsSpriteSheet, spotSpriteSheet, dottedLine,
      spinSetterLarge, cueBallSpot, guiSolids, guiStripes, marker,
      ballSpriteSheets: { 9: bs9, 10: bs10, 11: bs11, 12: bs12, 13: bs13, 14: bs14, 15: bs15 },
    },
    audio: { ballHit, cueHit, cushionHit, pocketHit, ding, cheer },
  };
}
