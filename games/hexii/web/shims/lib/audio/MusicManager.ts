/**
 * Standalone stand-in for the site MusicManager.
 * The shared game shell calls play(), stop(), and the volume getters.
 * Playback waits for a gesture so browsers allow audio.
 */

const MASTER_KEY = "music-manager-master-volume";
const MUSIC_KEY = "music-manager-music-volume";

class MusicManagerClass {
  private currentMusic: HTMLAudioElement | null = null;
  private currentTrack: string | null = null;
  private musicVolume = 0.4;
  private masterVolume = 1;
  private isMuted = false;
  private hasUserInteracted = false;
  private pendingTrack: string | null = null;
  private fadeInterval: number | null = null;
  private fadeOutInterval: number | null = null;

  constructor() {
    this.loadSettings();
    this.setupUserInteractionHandler();
  }

  private loadSettings(): void {
    if (typeof window === "undefined") return;
    const savedMaster = localStorage.getItem(MASTER_KEY);
    const savedMusic = localStorage.getItem(MUSIC_KEY);
    if (savedMaster) this.masterVolume = parseInt(savedMaster, 10) / 100;
    if (savedMusic) this.musicVolume = parseInt(savedMusic, 10) / 100;
  }

  private setupUserInteractionHandler(): void {
    if (typeof window === "undefined") return;

    const handleInteraction = () => {
      this.hasUserInteracted = true;
      if (!this.pendingTrack) return;
      const track = this.pendingTrack;
      this.pendingTrack = null;
      this.play(track);
    };

    window.addEventListener("pointerdown", handleInteraction, true);
    window.addEventListener("keydown", handleInteraction, true);
  }

  private effectiveVolume(): number {
    return this.isMuted ? 0 : this.musicVolume * this.masterVolume;
  }

  play(
    trackPath: string,
    options: { loop?: boolean; fadeDuration?: number } = {},
  ): void {
    if (typeof window === "undefined") return;
    const { loop = true, fadeDuration = 1000 } = options;

    if (this.currentTrack === trackPath && this.currentMusic) return;

    if (!this.hasUserInteracted) {
      this.pendingTrack = trackPath;
      return;
    }

    if (this.fadeOutInterval) {
      clearInterval(this.fadeOutInterval);
      this.fadeOutInterval = null;
    }

    const previous = this.currentMusic;
    const next = new Audio(trackPath);
    next.loop = loop;
    next.volume = 0;
    this.currentMusic = next;
    this.currentTrack = trackPath;

    next.play().catch(() => {
      // Autoplay can still fail if the gesture was not trusted. Queue it.
      this.pendingTrack = trackPath;
    });

    this.crossfade(previous, next, fadeDuration);
  }

  private crossfade(
    previous: HTMLAudioElement | null,
    next: HTMLAudioElement,
    duration: number,
  ): void {
    if (this.fadeInterval) clearInterval(this.fadeInterval);

    const steps = 30;
    const stepDuration = duration / steps;
    const target = this.effectiveVolume();
    let step = 0;

    this.fadeInterval = window.setInterval(() => {
      step += 1;
      const progress = step / steps;
      if (previous) previous.volume = Math.max(0, target * (1 - progress));
      next.volume = Math.min(target, target * progress);
      if (step >= steps) {
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        this.fadeInterval = null;
        previous?.pause();
      }
    }, stepDuration);
  }

  stop(fadeOut = true): void {
    const music = this.currentMusic;
    this.pendingTrack = null;
    if (!music) {
      this.currentTrack = null;
      return;
    }

    if (!fadeOut) {
      music.pause();
      this.currentMusic = null;
      this.currentTrack = null;
      return;
    }

    if (this.fadeOutInterval) clearInterval(this.fadeOutInterval);
    const start = music.volume;
    const steps = 30;
    let step = 0;
    this.fadeOutInterval = window.setInterval(() => {
      step += 1;
      music.volume = Math.max(0, start * (1 - step / steps));
      if (step >= steps) {
        if (this.fadeOutInterval) clearInterval(this.fadeOutInterval);
        this.fadeOutInterval = null;
        if (this.currentMusic === music) {
          music.pause();
          this.currentMusic = null;
          this.currentTrack = null;
        }
      }
    }, 1000 / steps);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.currentMusic) this.currentMusic.volume = this.effectiveVolume();
    if (typeof window !== "undefined") {
      localStorage.setItem(
        MASTER_KEY,
        Math.round(this.masterVolume * 100).toString(),
      );
    }
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.currentMusic) this.currentMusic.volume = this.effectiveVolume();
    if (typeof window !== "undefined") {
      localStorage.setItem(
        MUSIC_KEY,
        Math.round(this.musicVolume * 100).toString(),
      );
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }
}

export const musicManager = new MusicManagerClass();
