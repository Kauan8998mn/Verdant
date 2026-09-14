export interface ClientPreferences {
  backgroundColor: string;
  overlay: boolean;
  overlayOpacity: number;
  uiScale: number;
  externalMediaPreviews: boolean;
  speakingColor: string;
  speakingGlow: number;
  panelBlur: number;
}

const STORAGE_KEY = 'verdant.client.preferences.v3';

export const DEFAULT_CLIENT_PREFERENCES: ClientPreferences = {
  backgroundColor: '#08100f',
  overlay: false,
  overlayOpacity: 0.72,
  uiScale: 1,
  externalMediaPreviews: false,
  speakingColor: '#91d4c7',
  speakingGlow: 0.68,
  panelBlur: 18
};

export function loadClientPreferences(): ClientPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
      ?? localStorage.getItem('verdant.client.preferences.v2')
      ?? localStorage.getItem('verdant.client.preferences.v1');
    if (!raw) return { ...DEFAULT_CLIENT_PREFERENCES };
    return sanitizePreferences(JSON.parse(raw) as Partial<ClientPreferences>);
  } catch {
    return { ...DEFAULT_CLIENT_PREFERENCES };
  }
}

export function saveClientPreferences(preferences: ClientPreferences): ClientPreferences {
  const sanitized = sanitizePreferences(preferences);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  applyClientPreferences(sanitized);
  return sanitized;
}

export function resetClientPreferences(): ClientPreferences {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('verdant.client.preferences.v2');
  localStorage.removeItem('verdant.client.preferences.v1');
  const defaults = { ...DEFAULT_CLIENT_PREFERENCES };
  applyClientPreferences(defaults);
  return defaults;
}

export function applyClientPreferences(preferences: ClientPreferences): void {
  const root = document.documentElement;
  const base = hexToRgb(preferences.backgroundColor) ?? hexToRgb(DEFAULT_CLIENT_PREFERENCES.backgroundColor)!;
  const lightTheme = isLightBackground(preferences.backgroundColor);
  const backgrounds = lightTheme
    ? { bg0: base, bg1: mix(base,{r:0,g:0,b:0},.035), bg2: mix(base,{r:0,g:0,b:0},.07), bg3: mix(base,{r:0,g:0,b:0},.11), bg4: mix(base,{r:0,g:0,b:0},.16) }
    : { bg0: mix(base,{r:0,g:0,b:0},.18), bg1: mix(base,{r:255,g:255,b:255},.035), bg2: mix(base,{r:255,g:255,b:255},.075), bg3: mix(base,{r:255,g:255,b:255},.12), bg4: mix(base,{r:255,g:255,b:255},.18) };
  const text = lightTheme ? {r:20,g:22,b:22} : {r:220,g:232,b:229};
  const muted = lightTheme ? {r:67,g:73,b:72} : {r:135,g:153,b:149};
  const faint = lightTheme ? {r:93,g:99,b:98} : {r:97,g:113,b:110};
  const accent = lightTheme ? mix(base,{r:0,g:0,b:0},base.r+base.g+base.b>700?.42:.28) : mix(base,{r:255,g:255,b:255},base.r+base.g+base.b<45?.55:.48);
  const accent2 = lightTheme ? mix(accent,{r:0,g:0,b:0},.16) : mix(accent,{r:255,g:255,b:255},.14);
  const accentText = lightTheme ? {r:255,g:255,b:255} : {r:8,g:14,b:13};
  for (const [name,rgb] of Object.entries({'--bg-0':backgrounds.bg0,'--bg-1':backgrounds.bg1,'--bg-2':backgrounds.bg2,'--bg-3':backgrounds.bg3,'--bg-4':backgrounds.bg4,'--text':text,'--muted':muted,'--faint':faint,'--accent':accent,'--accent-2':accent2,'--accent-text':accentText})) setColorVar(root,name,rgb as Rgb);
  setColorVar(root,'--text-soft',mix(text,muted,.28));
  setColorVar(root,'--accent-hover',lightTheme?mix(accent,{r:0,g:0,b:0},.08):mix(accent,{r:255,g:255,b:255},.12));
  setRgbVar(root,'--bg-0-rgb',backgrounds.bg0); setRgbVar(root,'--bg-1-rgb',backgrounds.bg1); setRgbVar(root,'--bg-2-rgb',backgrounds.bg2); setRgbVar(root,'--bg-3-rgb',backgrounds.bg3); setRgbVar(root,'--bg-4-rgb',backgrounds.bg4);
  setRgbVar(root,'--text-rgb',text); setRgbVar(root,'--accent-rgb',accent);
  root.style.setProperty('--line',`rgba(${text.r}, ${text.g}, ${text.b}, ${lightTheme?.14:.08})`);
  root.style.setProperty('--line-strong',`rgba(${text.r}, ${text.g}, ${text.b}, ${lightTheme?.24:.15})`);
  root.style.setProperty('--shadow',lightTheme?'0 18px 55px rgba(0,0,0,.18)':'0 18px 55px rgba(0,0,0,.34)');

  const opacity=clamp(preferences.overlayOpacity,.45,.95);
  const speaking = hexToRgb(preferences.speakingColor) ?? hexToRgb(DEFAULT_CLIENT_PREFERENCES.speakingColor)!;
  const speakingGlow = clamp(preferences.speakingGlow,0,1);
  setColorVar(root,'--speaking-color',speaking);
  setRgbVar(root,'--speaking-rgb',speaking);
  root.style.setProperty('--speaking-glow',`rgba(${speaking.r}, ${speaking.g}, ${speaking.b}, ${(0.12 + speakingGlow * 0.52).toFixed(3)})`);
  root.style.setProperty('--speaking-glow-soft',`rgba(${speaking.r}, ${speaking.g}, ${speaking.b}, ${(0.06 + speakingGlow * 0.22).toFixed(3)})`);
  root.style.setProperty('--speaking-ring',`rgba(${speaking.r}, ${speaking.g}, ${speaking.b}, ${(0.26 + speakingGlow * 0.56).toFixed(3)})`);
  const speakingBlur = Math.round(10 + speakingGlow * 28);
  root.style.setProperty('--speaking-blur',`${speakingBlur}px`);
  root.style.setProperty('--speaking-blur-small',`${Math.max(8, Math.round(speakingBlur * .72))}px`);
  root.style.setProperty('--speaking-blur-wide',`${Math.round(speakingBlur * 1.7)}px`);
  root.style.setProperty('--panel-blur',`${Math.round(clamp(preferences.panelBlur,0,32))}px`);
  root.style.setProperty('--ui-scale',String(clamp(preferences.uiScale,.8,1.35)));
  root.style.setProperty('--app-opacity',String(preferences.overlay?Math.max(.2,opacity-.18):1));
  root.style.setProperty('--panel-opacity',String(preferences.overlay?opacity:.96));
  root.style.setProperty('--main-opacity',String(preferences.overlay?Math.max(.35,opacity-.08):.82));
  root.style.setProperty('--header-opacity',String(preferences.overlay?Math.max(.3,opacity-.12):.74));
  root.style.setProperty('--composer-opacity',String(preferences.overlay?Math.min(.98,opacity+.08):.98));
  root.dataset.lightTheme=lightTheme?'true':'false'; root.dataset.overlay=preferences.overlay?'true':'false';
}

function sanitizePreferences(input: Partial<ClientPreferences>): ClientPreferences {
  return {
    backgroundColor: normalizeHex(input.backgroundColor)??DEFAULT_CLIENT_PREFERENCES.backgroundColor,
    overlay:Boolean(input.overlay),
    overlayOpacity:clamp(Number(input.overlayOpacity??DEFAULT_CLIENT_PREFERENCES.overlayOpacity),.45,.95),
    uiScale:clamp(Number(input.uiScale??DEFAULT_CLIENT_PREFERENCES.uiScale),.8,1.35),
    externalMediaPreviews:Boolean(input.externalMediaPreviews),
    speakingColor:normalizeHex(input.speakingColor)??DEFAULT_CLIENT_PREFERENCES.speakingColor,
    speakingGlow:clamp(Number(input.speakingGlow??DEFAULT_CLIENT_PREFERENCES.speakingGlow),0,1),
    panelBlur:clamp(Number(input.panelBlur??DEFAULT_CLIENT_PREFERENCES.panelBlur),0,32)
  };
}
export function isLightBackground(value:string):boolean { const rgb=hexToRgb(value)??hexToRgb(DEFAULT_CLIENT_PREFERENCES.backgroundColor)!; return (Math.max(rgb.r,rgb.g,rgb.b)/255+Math.min(rgb.r,rgb.g,rgb.b)/255)/2>=.5; }
export function normalizeHex(value:unknown):string|undefined { if(typeof value!=='string')return; const t=value.trim().toLowerCase(); if(/^#[0-9a-f]{6}$/.test(t))return t; if(/^#[0-9a-f]{3}$/.test(t))return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`; }
interface Rgb {r:number;g:number;b:number}
function hexToRgb(value:string):Rgb|undefined { const h=normalizeHex(value); if(!h)return; return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}; }
function mix(a:Rgb,b:Rgb,ratio:number):Rgb { const t=clamp(ratio,0,1); return {r:Math.round(a.r*(1-t)+b.r*t),g:Math.round(a.g*(1-t)+b.g*t),b:Math.round(a.b*(1-t)+b.b*t)}; }
function setColorVar(root:HTMLElement,name:string,rgb:Rgb):void { root.style.setProperty(name,`#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`); }
function setRgbVar(root:HTMLElement,name:string,rgb:Rgb):void { root.style.setProperty(name,`${rgb.r}, ${rgb.g}, ${rgb.b}`); }
function toHex(value:number):string { return clamp(Math.round(value),0,255).toString(16).padStart(2,'0'); }
function clamp(value:number,min:number,max:number):number { return Math.min(max,Math.max(min,Number.isFinite(value)?value:min)); }
