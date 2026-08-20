/**
 * Content for the party games, kept out of the screen components so the
 * games themselves stay small and the texts are easy to extend.
 *
 * Tone: every prompt offers a way out ("oder trinke"), and nothing tells
 * people to empty a glass or race each other. A sip is always enough, and
 * players can take a non-alcoholic drink instead — the app's whole point is
 * a fun evening, not maximum consumption.
 */

export type Intensity = "harmlos" | "party" | "spicy";

export const INTENSITY_LABELS: Record<Intensity, string> = {
  harmlos: "Harmlos",
  party: "Party",
  spicy: "Prickelnd 18+",
};

// ─── Ich hab noch nie ─────────────────────────────────────────────────────
// Wer es schon gemacht hat, nimmt einen Schluck.
export const NEVER_HAVE_I_EVER: Record<Intensity, string[]> = {
  harmlos: [
    "…ein ganzes Wochenende nur im Bett Serien geschaut.",
    "…mich im eigenen Wohnort komplett verlaufen.",
    "…einen Wecker gestellt und trotzdem eiskalt verschlafen.",
    "…heimlich das Essen oder die Süßigkeiten von jemand anderem gegessen.",
    "…jemanden auf der Straße gegrüßt, den ich mit jemand anderem verwechselt habe.",
    "…einen Film geschaut und danach behauptet, ich hätte das Buch gelesen.",
    "…mir selbst eine Nachricht oder E-Mail geschrieben, um nichts zu vergessen.",
    "…beim Karaoke laut mitgesungen, obwohl ich den Text überhaupt nicht kannte.",
    "…drei Tage hintereinander dieselbe Jogginghose getragen.",
    "…einen Kochversuch so verbockt, dass wir kurzfristig Pizza bestellen mussten.",
    "…im Supermarkt etwas völlig Unnötiges gekauft, nur weil ein Rabatt-Schild drauf war.",
    "…mich vor einem Insekt oder Tier erschrocken, das kleiner war als meine Hand.",
    "…eine Nachricht gelesen, absichtlich ignoriert und Stunden später gesagt: 'Sorry, hab's erst jetzt gesehen'.",
    "…so getan als würde ich telefonieren, um jemandem aus dem Weg zu gehen.",
    "…beim Friseur gesagt 'Sieht super aus!', obwohl ich zu Hause fast geweint habe.",
    "…nach einer Serie gegoogelt, ob eine Schauspiel-Beziehung auch im echten Leben existiert.",
    "…beim Einkaufen heimlich eine Weintraube oder Kirsche probiert.",
    "…über einen Witz gelacht, den ich eigentlich gar nicht verstanden habe.",
    "…beim Zähneputzen vor dem Spiegel ein fiktives Interview geführt.",
    "…eine Sprachnachricht angehört und sofort bereut, wie meine Stimme klingt.",
    "…meinen Namen gegoogelt, um zu sehen was über mich im Netz steht.",
    "…ein Geschenk weiterverschenkt, weil ich nichts damit anfangen konnte.",
    "…so getan als würde ich etwas verstehen, nur damit die andere Person aufhört es zu erklären.",
    "…versehentlich einen Videoanruf gestartet und vor Schreck fast das Handy weggeworfen.",
    "…im Restaurant das Gleiche bestellt wie mein Sitznachbar, weil die Karte zu groß war.",
    "…im Auto so laut mitgesungen, dass die Leute im Nachbarauto geguckt haben.",
    "…ein Buch gekauft, nur weil das Cover im Regal gut aussah.",
    "…bei einer Diät oder beim Fasten schon am zweiten Tag heimlich geschummelt.",
    "…mich selbst auf einem Foto im Hintergrund einer fremden Story gesucht.",
    "…beim Einparken die Musik leiser gedreht, um 'besser sehen zu können'.",
    "…jemandem gratuliert und dabei den falschen Namen oder das falsche Datum erwischt.",
    "…im Urlaub die Sprache versucht zu sprechen und etwas völlig Falsches bestellt.",
    "…ein Kleidungsstück im Laden anprobiert, ein Selfie gemacht und es dann wieder weggehängt.",
    "…eine App deinstalliert, nur um sie 20 Minuten später wieder herunterzuladen.",
    "…eine Pflanze überwässert und behauptet, sie sei an der schlechten Erde gestorben.",
  ],
  party: [
    "…auf einer Party als Erster getanzt, obwohl noch niemand auf der Tanzfläche war.",
    "…am Morgen danach mit pochendem Kopf mein Handy nach peinlichen Fotos durchsucht.",
    "…einen Kater mit kaltem Döner oder fettiger Pizza bekämpft.",
    "…an einer Bushaltestelle, im Zug oder am Bahnhof kurz eingenickt.",
    "…jemandem ein Getränk spendiert, nur um einen Vorwand für ein Gespräch zu haben.",
    "…die allerletzte Bahn verpasst und nachts zu Fuß nach Hause laufen müssen.",
    "…um 3 Uhr nachts mit Freunden noch eine Heißluftfritteusen-Session gestartet.",
    "…einer wildfremden Person auf einer Feier mein halbes Leben anvertraut.",
    "…behauptet 'Ich trinke heute nur eins' – und war bis zum Morgengrauen da.",
    "…mich am nächsten Tag für eine betrunkene Sprachnachricht entschuldigen müssen.",
    "…auf einer Couch eingeschlafen, während um mich herum 15 Leute weitergefeiert haben.",
    "…mein Getränk verwechselt und aus Versehen das Glas von jemand anderem geleert.",
    "…eine Runde Schnaps bestellt, die eigentlich niemand mehr gebraucht hat.",
    "…den Text von 'Mr. Brightside', 'Wonderwall' oder 'Angels' bei voller Lautstärke mitgebrüllt.",
    "…beim Beer-Pong geschummelt, während der Gegner nicht hingeschaut hat.",
    "…am nächsten Morgen meine Schuhe, meine Jacke oder mein Portemonnaie suchen müssen.",
    "…aus einem Stiefel, einer Schöpfkelle oder einem Trichter getrunken.",
    "…beim Verlassen des Clubs bemerkt, dass es draußen schon wieder taghell und sonnig ist.",
    "…versucht, nüchtern vor meinen Eltern oder Mitbewohnern zu wirken, und bin kläglich gescheitert.",
    "…mit dem Türsteher oder der Bar-Crew Freundschaft geschlossen, um schneller reinzukommen.",
    "…auf einer Party das Handy als DJ an die Box gehängt und die Playlist komplett gekapert.",
    "…eine Wette abgeschlossen, bei der ich am nächsten Tag etwas Verrücktes einlösen musste.",
    "…beim 'Flunkyball' oder 'Rage Cage' den Becher quer über den Rasen gepfeffert.",
    "…den gesamten Heimweg überlegt, was ich jetzt noch Essbares im Kühlschrank finde.",
    "…am Tag nach einer Party auf der Couch gelegen und geschworen: 'Ich trinke nie wieder Alkohol'.",
    "…auf einer WG-Party in einer Badewanne oder auf dem Balkonboden gechillt.",
    "…einen Toast auf jemanden ausgebracht, den ich erst seit 10 Minuten kenne.",
    "…eine Sonnenbrille nachts im Club getragen, weil ich dachte, es sieht cool aus.",
    "…meinen Freunden versprochen 'Ich passe heute auf dich auf' und war 2 Stunden später selbst lost.",
    "…vor dem Feiergehen vorglühen wollen und fast das eigentliche Event verpasst.",
  ],
  spicy: [
    "…jemanden auf einer Party geküsst, dessen Namen ich am nächsten Tag nicht mehr wusste.",
    "…mit zwei Personen am selben Abend geflirtet, während beide im selben Raum waren.",
    "…eine Nachricht an meinen Schwarm geschickt und vor Panik sofort das Handy ausgeschaltet.",
    "…jemanden aus dieser Runde heimlich extrem attraktiv gefunden.",
    "…nachts um 2 Uhr eine Nachricht an eine verflossene Flamme oder Ex getippt.",
    "…in der Öffentlichkeit oder an einem ungewöhnlichen Ort geknutscht.",
    "…das Profil von jemandem bis ins Jahr 2018 zurückgescrollt und aus Versehen ein altes Bild gelikt.",
    "…so getan als wäre ich vergeben oder hätte einen Freund/eine Freundin, um jemanden abzuwimmeln.",
    "…ein Date nach 15 Minuten mit einer erfundenen Notfall-Ausrede abgebrochen.",
    "…jemandem meine Gefühle gestanden und am nächsten Tag die Schuld auf den Alkohol geschoben.",
    "…eine spicy Nachricht oder ein Foto an die falsche Person oder Gruppe geschickt.",
    "…in einem Club mit jemandem getanzt, nur um eine andere Person eifersüchtig zu machen.",
    "…jemandem ein falsches Alter oder einen erfundenen Beruf erzählt, um interessanter zu wirken.",
    "…auf einer Dating-App jemanden gematcht, den ich aus dem echten Leben kenne, und nie angeschrieben.",
    "…ein Kleidungsstück bei jemand anderem 'vergessen', um einen Grund für ein Wiedersehen zu haben.",
    "…jemanden geküsst, nur um eine Wahrheit-oder-Pflicht-Aufgabe nicht trinken zu müssen.",
    "…überlegt, wie eine Beziehung mit jemandem aus dieser Runde wohl wäre.",
    "…ein Bild in die Story gestellt, nur damit eine ganz bestimmte Person es sieht.",
    "…beim Flirten so nervös gewesen, dass ich mein eigenes Getränk verschüttet habe.",
    "…jemandem ein Kompliment gemacht, das viel zweideutiger rüberkam als beabsichtigt.",
  ],
};

// ─── Wer würde eher…? ─────────────────────────────────────────────────────
// Die Gruppe zeigt auf 3, 2, 1 auf eine Person. Wer die meisten Finger auf sich hat, trinkt!
export const WHO_WOULD_RATHER: Record<Intensity, string[]> = {
  harmlos: [
    "Wer würde eher verschlafen, trotzdem pünktlich ankommen und so tun als wäre nichts gewesen?",
    "Wer würde eher eine ganze Familienpackung Eiscreme an einem Abend alleine aufessen?",
    "Wer würde eher beim Wandern die 'Abkürzung' vorschlagen und die ganze Gruppe im Dickicht verirren?",
    "Wer würde eher sein zukünftiges Haustier nach einem Lieblings-Anime oder einer Serienfigur benennen?",
    "Wer würde eher bei einer Fernseh-Quizshow den 50:50-Joker bei Frage 1 verbrauchen?",
    "Wer würde eher aus Versehen eine fremde Person im Supermarkt von hinten umarmen?",
    "Wer würde eher 45 Minuten lang ungebremst und begeistert über ein völlig obskures Hobby referieren?",
    "Wer würde eher ohne Navi losfahren und nach 20 Minuten im Nachbarbundesland landen?",
    "Wer würde eher an einem Regentag 10 Stunden lang denselben Song auf Dauerschleife hören?",
    "Wer würde eher eine Pflanze aus Plastik gießen und sich wundern, warum sie nicht wächst?",
    "Wer würde eher sein Handy suchen, während er damit am Ohr telefoniert?",
    "Wer würde eher bei einem Brettspiel heimlich Geld von der Bank klauen?",
    "Wer würde eher bei einer Gruselgeschichte als Erster aufschreien?",
    "Wer würde eher ein Buch kaufen, um es ungelesen ins Regal zu stellen?",
    "Wer würde eher ein IKEA-Möbelstück komplett ohne Anleitung aufbauen und am Ende 12 Schrauben übrig haben?",
    "Wer würde eher den Müll erst rausbringen, wenn er die Höhe eines Mount Everest erreicht hat?",
    "Wer würde eher im Kino laut lachen, wenn die Szene eigentlich traurig ist?",
    "Wer würde eher beim Smalltalk vergessen, wie die andere Person heißt, obwohl sie sich gerade vorgestellt hat?",
    "Wer würde eher mit vollem Akku losgehen und 2 Stunden später mit 3% dastehen?",
    "Wer würde eher das Rezept komplett ignorieren und behaupten: 'Ich koche nach Gefühl'?",
  ],
  party: [
    "Wer würde eher als Allererster die leere Tanzfläche stürmen und das Eis brechen?",
    "Wer würde eher spontan die After-Party für 20 Leute in seiner eigenen Wohnung ausrufen?",
    "Wer würde eher am nächsten Morgen um 8:00 Uhr fit aufstehen und Brötchen für alle holen?",
    "Wer würde eher das Mikrofon beim Karaoke bis zum Ende des Abends nicht mehr hergeben?",
    "Wer würde eher im Überschwang eine Runde Tequila für den gesamten Tisch spendieren?",
    "Wer würde eher im Nachtbus einnicken und an der Endhaltestelle irgendwo im Nirgendwo aufwachen?",
    "Wer würde eher mit dem Türsteher, dem Barkeeper und der Garderobendame beste Freunde werden?",
    "Wer würde eher am Ende des Abends wie die Mutti/der Vati der Gruppe alle sicher ins Taxi setzen?",
    "Wer würde eher beim Beer-Pong den finalen Trick-Shot versuchen und das Glas umwerfen?",
    "Wer würde eher nachts um 4 Uhr mit einer Straßenlaterne oder einem Hund im Park philosophieren?",
    "Wer würde eher auf einer Party barfuß tanzen, weil die Schuhe drücken?",
    "Wer würde eher auf dem Heimweg noch einen Döner mit 'extra Knoblauch und scharf' verdrücken?",
    "Wer würde eher eine spontane Polonaise durch die gesamte Bar anführen?",
    "Wer würde eher am nächsten Morgen feststellen, dass er den Schlüssel in der Jackentasche von jemand anderem gelassen hat?",
    "Wer würde eher ein Trinkspiel erfinden, dessen Regeln nach Runde 3 niemand mehr kapiert?",
    "Wer würde eher am Tag danach das epischste Katerfrühstück der Welt kochen?",
    "Wer würde eher eine fremde Party crashen und am Ende mit den Gastgebern auf dem Sofa sitzen?",
    "Wer würde eher auf der Tanzfläche einen Spagat oder Breakdance-Move probieren und sich blamieren?",
    "Wer würde eher den DJ so lange mit Musikwünschen nerven, bis er nachgibt?",
    "Wer würde eher sein Glas irgendwo abstellen und 5 Minuten später 3 andere Gläser fragen: 'Seid ihr meins?'?",
  ],
  spicy: [
    "Wer würde eher im Club die Initiative ergreifen und seinen Schwarm direkt ansprechen?",
    "Wer würde eher noch am selben Abend ein spontanes Date für den nächsten Tag vereinbaren?",
    "Wer würde eher ein pikantes Geheimnis ausplaudern, wenn er 2 Bier intus hat?",
    "Wer würde eher nachts um 3 Uhr eine gefühlvolle 'Ich vermisse dich'-Nachricht tippen?",
    "Wer würde eher bei Wahrheit oder Pflicht immer die mutigste Pflichtaufgabe wählen?",
    "Wer würde eher mit jemandem aus dieser Runde auf ein Date gehen?",
    "Wer würde eher den ersten Kuss bei einem Date initiieren?",
    "Wer würde eher beim Flirten so übertreiben, dass alle Freunde daneben fremdschämen?",
    "Wer würde eher seinem Schwarm auf Instagram ein Bild aus dem Jahr 2019 liken?",
    "Wer würde eher bei einem Date behaupten, er könne perfekt kochen, und dann Lieferdienst bestellen?",
    "Wer würde eher eine Schwäche für 'Bad Boys' oder 'Bad Girls' haben?",
    "Wer würde eher die beste Wingwoman oder der beste Wingman des Abends sein?",
    "Wer würde eher nach einem Glas Wein anfangen, über Seelenverwandtschaft zu philosophieren?",
    "Wer würde eher jemanden küssen, nur um ein Trinkspiel zu gewinnen?",
  ],
};

// ─── Wahrheit oder Pflicht (Truth or Dare) ────────────────────────────────
export const TRUTHS: Record<Intensity, string[]> = {
  harmlos: [
    "Was ist das Peinlichste, das dir in der Schule oder Uni je passiert ist?",
    "Welche Serie oder welchen Film schaust du heimlich als 'Guilty Pleasure'?",
    "Was war die schlechteste Ausrede, die du je erfunden hast, um nicht ausgehen zu müssen?",
    "Welchen Star oder welche Zeichentrickfigur fandest du als Kind heimlich attraktiv?",
    "Was ist die seltsamste Essenskombination, die du heimlich liebst?",
    "Wann hast du das letzte Mal vor einem Spiegel geübt, wie du 'lässig' aussiehst?",
    "Welche Mode-Sünde aus deiner Jugend ist dir heute noch extrem peinlich?",
    "Hast du schon mal ein Geschenk weiterverschenkt und was war es?",
    "Was ist deine größte, völlig unlogische Phobie (z. B. vor Clowns, Fröschen, Knöpfen)?",
    "Was war das Dümmste, wofür du jemals mehr als 50 Euro ausgegeben hast?",
    "Welches Lied kannst du von Anfang bis Ende fehlerfrei mitsingen?",
    "Hast du schon mal so getan als hättest du eine Nachricht nicht bekommen?",
    "Was ist die schlechteste Note, die du je vor deinen Eltern verheimlicht hast?",
    "Was war dein peinlichster Benutzername oder deine erste E-Mail-Adresse?",
  ],
  party: [
    "Was ist das Verrückteste, das du je unter Alkoholeinfluss getan hast?",
    "Wer in dieser Runde verträgt deiner Meinung nach am meisten und wer am wenigsten?",
    "Was war dein schlimmster Kater aller Zeiten und wie hast du ihn überlebt?",
    "Hast du schon mal auf einer Party heimlich Alkohol nachgeschenkt oder Wasser ins Glas gefüllt?",
    "Was war der schlechteste Anmachspruch, den du je gehört oder selbst benutzt hast?",
    "Welche Party-Aktion am nächsten Morgen hast du am meisten bereut?",
    "Hast du jemals ein fremdes Getränk getrunken, weil du dachtest, es sei deins?",
    "Wer aus dieser Runde wäre die beste Begleitung, um eine Nacht im Club durchzuziehen?",
    "Was ist das Verrückteste, was du nach 3 Uhr nachts noch bestellt oder gegessen hast?",
    "Bist du jemals ohne zu bezahlen aus einem Club oder einer Bar gegangen (absichtlich oder unabsichtlich)?",
    "Was war das peinlichste Foto, das je von dir auf einer Feier geschossen wurde?",
    "Hast du schon mal auf einer Tanzfläche so getan als würdest du jemanden kennen, um einen Drink zu kriegen?",
  ],
  spicy: [
    "Mit wem aus diesem Raum könntest du dir am ehesten einen Kuss vorstellen?",
    "Was war dein bisher aufregendstes oder peinlichstes Date?",
    "Welche Eigenschaft an einer Person bringt dich sofort um den Verstand?",
    "Hast du schon mal nachts jemandem geschrieben und es am nächsten Morgen bitter bereut?",
    "Was ist dein heimlicher 'Type' bei Dating-Partnern, zu dem du ungern stehst?",
    "Was war der ungewöhnlichste Ort, an dem du je mit jemandem geknutscht hast?",
    "Wurdest du jemals beim Flirten oder Knutschen von Fremden oder Freunden erwischt?",
    "Welche Nachricht in deinen DMs ist dir am peinlichsten?",
    "Wer in dieser Runde hat die attraktivste Ausstrahlung?",
    "Hast du schon mal Gefühle für jemanden vorgespielt, um nicht gemein zu sein?",
  ],
};

export const DARES: Record<Intensity, string[]> = {
  harmlos: [
    "Sprich für die nächsten 2 Runden nur noch mit einem übertriebenen britischen oder französischen Akzent.",
    "Mach 10 Kniebeugen und singe dabei den Refrain deines Lieblings-Popsongs.",
    "Mache der Person rechts von dir ein tief empfundenes, völlig übertriebenes Kompliment.",
    "Lass die Gruppe ein beliebiges Emoji auswählen, das du als Status in deiner Story postest.",
    "Trinke deinen nächsten Schluck, ohne deine Hände zu benutzen (Glas mit dem Mund anheben).",
    "Halte eine 30-sekündige leidenschaftliche Rede darüber, warum Pizza das beste Essen der Welt ist.",
    "Stelle dich auf einen Stuhl und verkünde der Runde mit königlicher Stimme eine neue Hausregel.",
    "Mache für 30 Sekunden eine perfekte Pantomime von einem Huhn, das ein Ei legt.",
    "Lies deine letzte gesendete Nachricht mit einer dramatischen Theater-Stimme laut vor.",
    "Lass dir von der Person links von dir die Haare für den Rest der Runde neu stylen.",
  ],
  party: [
    "Tausche für die nächsten 2 Runden dein Oberteil oder deine Mütze mit der Person dir gegenüber.",
    "Erfinde einen brandneuen Trinkspruch und bringe die gesamte Runde dazu, ihn gemeinsam anzustimmen.",
    "Mache den Ententanz für 30 Sekunden mitten im Raum – die anderen klatschen den Takt.",
    "Trinke einen Schluck Wasser oder Bier auf Ex, während die anderen laut bis 5 herunterzählen.",
    "Gehe reihum und errate bei jedem Mitspieler, welches Getränk am besten zu seiner Persönlichkeit passt.",
    "Lass dir von der Gruppe eine Pose vorgeben und halte sie regungslos für 45 Sekunden.",
    "Versuche, 30 Sekunden lang auf einem Bein zu balancieren und dabei ein Schlaflied zu summen.",
    "Sprich die nächste Runde nur noch in Reimen. Wenn du nicht reimen kannst: 1 Strafschluck.",
    "Mache 5 Liegestütze oder trinke 2 Schlucke als Alternative.",
    "Lass die Person links von dir ein lustiges Selfie von dir machen und an einen Gruppenchat schicken.",
  ],
  spicy: [
    "Flüstere der Person dir gegenüber ein freches Kompliment ins Ohr.",
    "Halte für 30 Sekunden ununterbrochenen Blickkontakt mit der Person deiner Wahl, ohne zu lachen.",
    "Lass dir von der Person rechts von dir mit geschlossenen Augen über die Wange streichen.",
    "Gib der Person, die du am attraktivsten findest, einen zärtlichen Handkuss.",
    "Sende deinem Schwarm oder Match ein einzelnes zufälliges Emoji ohne weiteren Text (oder trinke 3 Schlucke).",
    "Setze dich für die nächsten 2 Runden ganz nah neben die Person, die dir die Aufgabe stellt.",
    "Mache deinen verführerischsten 'Model-Blick' in die Handykamera.",
    "Lass die Gruppe eine Frage in deinem Dating-Profil oder deiner Bio umformulieren.",
  ],
};

// ─── Wortbombe: Kategorien & Silben ───────────────────────────────────────
export const WORD_BOMB_CATEGORIES: string[] = [
  // Getränke & Party
  "Biersorten & Biermarken",
  "Cocktails & Longdrinks",
  "Alkoholfreie Getränke & Softdrinks",
  "Schnapssorten & Liköre",
  "Dinge, die man auf einer Hausparty findet",
  "Typische Kater-Heilmittel",
  "Dinge, die man nachts an der Tankstelle kauft",
  "Partyspiele & Trinkspiele",
  "Dinge, die man im Club verlieren kann",
  "Festival-Ausrüstung",

  // Essen & Genuss
  "Pizzabeläge",
  "Eissorten",
  "Fast-Food-Ketten",
  "Süßigkeiten & Schokoriegel",
  "Früchte & Gemüsesorten",
  "Käsesorten",
  "Dinge, die man grillen kann",
  "Gewürze & Kräuter",
  "Gerichte aus Italien",
  "Sachen im Kühlschrank",

  // Popkultur, Film & Musik
  "Serien auf Netflix & Streaming",
  "Filme mit nur einem Wort im Titel",
  "Superhelden & Schurken (Marvel / DC)",
  "Bekannte Rapper & Hip-Hop-Künstler",
  "Musikinstrumente",
  "Disney-Filme & Zeichentrick-Klassiker",
  "Bands der 90er & 2000er",
  "Videospiele & Gaming-Franchises",
  "Schauspieler aus Hollywood",
  "Brettspiele & Kartenspiele",

  // Alltag, Berufe & Hobbys
  "Berufe mit Uniform oder Kittel",
  "Dinge im Badezimmer",
  "Automarken & Fahrzeughersteller",
  "Sportarten (inkl. Randsportarten)",
  "Dinge, die man im Handgepäck mitnimmt",
  "Hunderassen & Haustiere",
  "Werkzeuge im Baumarkt",
  "Dinge, die lauter als 80 Dezibel sind",
  "Hobbys, die man draußen macht",
  "Schulfächer",

  // Geografie & Welt
  "Hauptstädte in Europa",
  "Länder mit mehr als 50 Millionen Einwohnern",
  "Flüsse & Meere",
  "Städte in Deutschland mit mehr als 200.000 Einwohnern",
  "Urlaubsländer am Mittelmeer",
  "Sehenswürdigkeiten auf der Welt",
  "Inseln & Inselgruppen",
  "Berge & Gebirge",

  // Lustig & Absurd
  "Dinge, die man beim ersten Date NICHT sagen sollte",
  "Ausreden, warum man zu spät kommt",
  "Dinge, die peinlich sind, wenn man sie fallen lässt",
  "Gründe, warum eine Pflanze eingeht",
  "Dinge, die man niemals im Internet suchen sollte",
  "Verrückte Erfindungen",
  "Dinge, die man im Dunkeln nicht barfuß treten will",
  "Geräusche, die man nachts nicht im Haus hören will",
];

export const ALL_TRUTHS: string[] = [
  ...TRUTHS.harmlos,
  ...TRUTHS.party,
  ...TRUTHS.spicy,
];

export const ALL_DARES: string[] = [
  ...DARES.harmlos,
  ...DARES.party,
  ...DARES.spicy,
];

/** Zufälliges Element, ohne das zuletzt gezeigte zu wiederholen. */
export function pickRandom<T>(list: T[], exclude?: T): T {
  if (!list || list.length === 0) throw new Error("pickRandom: leere Liste");
  if (list.length === 1) return list[0];
  let item = list[Math.floor(Math.random() * list.length)];
  let guard = 0;
  while (exclude !== undefined && item === exclude && guard < 10) {
    item = list[Math.floor(Math.random() * list.length)];
    guard++;
  }
  return item;
}
