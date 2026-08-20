/**
 * Erzeugt die Bildmarke von TrinkDuell — als SVG-Quelle und als alle PNGs,
 * die Expo, Android, iOS und die Web-App brauchen.
 *
 * Warum ein eigener Rasterizer statt sharp oder resvg?
 * Beides waere eine neue native Abhaengigkeit in einem Projekt, das auf Expo
 * SDK 55 festgenagelt ist und dessen Abhaengigkeiten schon einmal Aerger
 * gemacht haben. `pngjs` liegt ohnehin im Baum. Die Bildmarke besteht nur aus
 * Polygonen, und die lassen sich mit ueberabgetastetem Punkt-in-Polygon-Test
 * sauber und kantengeglaettet fuellen — bei acht Groessen von 32 bis 1024
 * Pixeln ist das genau, was man will: jede Groesse wird aus der Geometrie neu
 * gerechnet statt aus einem grossen Bild heruntergerechnet.
 *
 * Aufruf:  node scripts/brand-icon.js
 *
 * Die Geometrie steht EINMAL hier. SVG und PNG entstehen aus derselben
 * Definition — sie koennen also nicht auseinanderlaufen.
 */

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.join(__dirname, "..");

// ─── Markenfarben ────────────────────────────────────────────────────────────
// Identisch zu src/services/theme.tsx (dark) und public/manifest.json.
const NAVY = "#020617"; // Hintergrund, entspricht dem Dunkelmodus der App
const CYAN = "#22d3ee"; // Akzent — vorderes Glas
const CYAN_TIEF = "#0891b2"; // Akzent im Hellmodus — hinteres Glas
const FOAM = "#e0f9ff"; // Schaum vorne
const FOAM_TIEF = "#93cddb"; // Schaum hinten
const VIOLET = "#c084fc"; // zweiter Akzent, nur der Funke im Kreuzungspunkt

// Zwei Helligkeiten sind Absicht: zwei gleich helle Glaeser verschmelzen an
// der Kreuzung zu einer Flaeche, und das Motiv liest sich dann als V statt
// als Kreuz. Ein dunkler Trennstrich waere die Alternative, funktioniert aber
// nicht auf den transparenten Varianten (Splash, Android-Vordergrund).

/** Zeichenfläche. Alle Koordinaten unten beziehen sich darauf. */
const SIZE = 1024;
const MID = SIZE / 2;

// ─── Geometrie ───────────────────────────────────────────────────────────────
//
// Zwei Gläser, wie Säbel gekreuzt — „Duell" und „Trinken" in einem Zeichen.
// Bewusst nur wenige, dicke Formen: bei 48 Pixeln überlebt nichts Feines.

/** Rechteck mit abgerundeten Ecken als Polygonzug. */
function roundedRect(x, y, w, h, r, steps = 6) {
  const pts = [];
  const ecken = [
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
    [x + w - r, y + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, start] of ecken) {
    for (let i = 0; i <= steps; i++) {
      const a = start + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/** Der Glaskörper: leicht konisch, unten gerundet. */
function glasKoerper() {
  const obenHalb = 92;
  const untenHalb = 68;
  const oben = -196;
  const unten = 226;
  const r = 30;
  const pts = [[-obenHalb, oben], [obenHalb, oben]];
  // Gerundeter Boden rechts nach links.
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * (Math.PI / 2);
    pts.push([untenHalb - r + Math.cos(a) * r, unten - r + Math.sin(a) * r]);
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI / 2 + t * (Math.PI / 2);
    pts.push([-untenHalb + r + Math.cos(a) * r, unten - r + Math.sin(a) * r]);
  }
  return pts;
}

/** Schaumkrone: eine gerundete Kappe, breiter als der Glasrand. */
function schaum() {
  return roundedRect(-112, -282, 224, 104, 46, 8);
}

/** Schmaler Glanzstreifen im Glas. Bei 48 Pixeln kaum sichtbar, stört aber nicht. */
function glanz() {
  return roundedRect(-56, -126, 34, 190, 17, 5);
}

/** Vier-zackiger Funke für den Kreuzungspunkt. */
function funke(r, innen) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : innen;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return pts;
}

function dreh(pts, grad, dx, dy) {
  const a = (grad * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return pts.map(([x, y]) => [x * cos - y * sin + dx, x * sin + y * cos + dy]);
}

/**
 * Wie viel der Kantenlänge das Motiv einnimmt. 1.0 ergab ein Motiv über nur
 * rund die Hälfte der Fläche — für ein App-Icon zu zaghaft, üblich sind etwa
 * 70 Prozent mit Rand ringsum.
 */
const MOTIF = 1.4;

/**
 * Die Bildmarke als Liste gefüllter Polygone, von hinten nach vorn.
 *
 * `motifScale` ist ein Faktor auf MOTIF: 1 ist die Normalgröße, kleinere Werte
 * für das Android-Vordergrundbild, wo das System außen bis zu 17 Prozent
 * wegschneidet und die Ecken eines X zuerst dran glauben müssten.
 */
function bildmarke({ motifScale = 1 } = {}) {
  // Kein seitlicher Versatz: beide Achsen laufen durch die Mitte, dadurch
  // kreuzen sie sich dort. Der erste Entwurf schob die Glaeser zusaetzlich
  // nach aussen — heraus kam ein V.
  const NEIGUNG = 33;
  const formen = [];

  // Hinteres Glas zuerst, dunkler; danach das vordere, heller.
  const lagen = [
    { grad: -NEIGUNG, glas: CYAN_TIEF, schaumFarbe: FOAM_TIEF },
    { grad: NEIGUNG, glas: CYAN, schaumFarbe: FOAM },
  ];
  for (const l of lagen) {
    formen.push({ pts: dreh(glasKoerper(), l.grad, 0, 30), fill: l.glas });
    formen.push({ pts: dreh(schaum(), l.grad, 0, 30), fill: l.schaumFarbe });
    formen.push({ pts: dreh(glanz(), l.grad, 0, 30), fill: FOAM, alpha: 0.22 });
  }

  formen.push({ pts: funke(96, 34), fill: VIOLET });
  formen.push({ pts: funke(52, 18), fill: FOAM });

  const s = MOTIF * motifScale;
  return formen.map((f) => ({
    ...f,
    pts: f.pts.map(([x, y]) => [MID + x * s, MID + y * s]),
  }));
}

// ─── SVG ─────────────────────────────────────────────────────────────────────

function alsSvg({ background = NAVY, motifScale = 1 } = {}) {
  const formen = bildmarke({ motifScale });
  const pfade = formen
    .map((f) => {
      const d = f.pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
      const opacity = f.alpha !== undefined ? ` opacity="${f.alpha}"` : "";
      return `  <path d="${d}" fill="${f.fill}"${opacity}/>`;
    })
    .join("\n");

  const hintergrund = background
    ? `  <rect width="${SIZE}" height="${SIZE}" fill="${background}"/>\n`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
${hintergrund}${pfade}
</svg>
`;
}

// ─── Rasterizer ──────────────────────────────────────────────────────────────

function hex(farbe) {
  return [
    parseInt(farbe.slice(1, 3), 16),
    parseInt(farbe.slice(3, 5), 16),
    parseInt(farbe.slice(5, 7), 16),
  ];
}

/** Punkt-in-Polygon nach dem Strahlenverfahren. */
function drin(pts, px, py) {
  let innen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      innen = !innen;
    }
  }
  return innen;
}

/**
 * Zeichnet die Bildmarke in ein PNG.
 *
 * `SS` ist die Überabtastung: jeder Zielpixel wird SS×SS mal getestet und der
 * Deckungsgrad gemittelt. Daher kommen die weichen Kanten — ohne das sähe das
 * Motiv bei 48 Pixeln nach Treppenstufen aus.
 */
function alsPng(datei, groesse, { background = NAVY, motifScale = 1, monochrom = null, nurHintergrund = false } = {}) {
  const formen = nurHintergrund ? [] : bildmarke({ motifScale });
  const png = new PNG({ width: groesse, height: groesse });
  const SS = 4;
  const skala = groesse / SIZE;
  const bg = background ? hex(background) : null;

  // Begrenzungsrahmen je Form: spart den Test für Pixel weit außerhalb.
  const rahmen = formen.map((f) => {
    const xs = f.pts.map((p) => p[0]);
    const ys = f.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      let r = bg ? bg[0] : 0;
      let g = bg ? bg[1] : 0;
      let b = bg ? bg[2] : 0;
      let a = bg ? 1 : 0;

      for (let fi = 0; fi < formen.length; fi++) {
        const f = formen[fi];
        const [minX, minY, maxX, maxY] = rahmen[fi];
        const px0 = x / skala;
        const py0 = y / skala;
        const schritt = 1 / skala;
        if (px0 + schritt < minX || px0 > maxX || py0 + schritt < minY || py0 > maxY) continue;

        let treffer = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const px = (x + (sx + 0.5) / SS) / skala;
            const py = (y + (sy + 0.5) / SS) / skala;
            if (drin(f.pts, px, py)) treffer++;
          }
        }
        if (treffer === 0) continue;

        const deckung = (treffer / (SS * SS)) * (f.alpha !== undefined ? f.alpha : 1);
        const [fr, fg, fb] = hex(monochrom || f.fill);
        const neuA = deckung + a * (1 - deckung);
        r = (fr * deckung + r * a * (1 - deckung)) / neuA;
        g = (fg * deckung + g * a * (1 - deckung)) / neuA;
        b = (fb * deckung + b * a * (1 - deckung)) / neuA;
        a = neuA;
      }

      const idx = (groesse * y + x) << 2;
      png.data[idx] = Math.round(r);
      png.data[idx + 1] = Math.round(g);
      png.data[idx + 2] = Math.round(b);
      png.data[idx + 3] = Math.round(a * 255);
    }
  }

  const ziel = path.join(ROOT, datei);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, PNG.sync.write(png));
  console.log(`  ${datei.padEnd(46)} ${groesse}x${groesse}`);
}

// ─── Ausgabe ─────────────────────────────────────────────────────────────────

console.log("SVG-Quellen:");
const svgs = [
  ["assets/brand/icon.svg", { background: NAVY }],
  ["assets/brand/icon-transparent.svg", { background: null }],
];
for (const [datei, opt] of svgs) {
  const ziel = path.join(ROOT, datei);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, alsSvg(opt), "utf8");
  console.log(`  ${datei}`);
}

console.log("PNGs:");
// App-Icon: voller Rand, deckender Hintergrund. iOS erlaubt keine Transparenz.
alsPng("assets/images/icon.png", 1024);
// Startbildschirm: transparent, liegt auf #020617 aus app.json.
alsPng("assets/images/splash-icon.png", 1024, { background: null });
// Android adaptiv: das System schneidet aussen bis zu 17 % weg, deshalb
// sitzt das Motiv hier kleiner in der Flaeche.
alsPng("assets/images/android-icon-foreground.png", 512, {
  background: null,
  motifScale: 0.7,
});
// Die Hintergrundebene traegt nur die Flaeche — das Motiv liegt darueber.
alsPng("assets/images/android-icon-background.png", 512, { nurHintergrund: true });
// Themed Icons (Android 13+): eine einzige Farbe, den Rest faerbt das System.
alsPng("assets/images/android-icon-monochrome.png", 432, {
  background: null,
  motifScale: 0.7,
  monochrom: "#ffffff",
});
alsPng("assets/images/favicon.png", 48);
alsPng("public/icon-192.png", 192);
alsPng("public/icon-512.png", 512);

console.log("\nFertig.");
