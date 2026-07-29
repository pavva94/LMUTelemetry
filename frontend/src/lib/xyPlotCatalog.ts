import type { Language } from "../i18n/resources";

type Localized = Record<Language, string>;

export type XYPlotDefinition = {
  id: string;
  tier: 1 | 2 | 3;
  title: Localized;
  axes: Localized;
  explanation: Localized;
  dotMeaning?: Localized;
  whatToLookFor?: Localized;
  example?: Localized;
  formula: string;
  supported: boolean;
  requirements?: Localized;
};

const l = (en: string, it: string): Localized => ({ en, it });

const plotDefinitions: XYPlotDefinition[] = [
  { id: "gg", tier: 1, title: l("G-G Diagram", "Diagramma G-G"), axes: l("Lateral G → Longitudinal G", "G laterale → G longitudinale"), explanation: l("Maps the vehicle's combined braking, cornering and acceleration grip envelope.", "Mappa l'inviluppo di aderenza combinando frenata, percorrenza e accelerazione."), formula: "combinedG = √(Gx² + Gy²)", supported: true },
  { id: "speed_binned_gg", tier: 1, title: l("Speed-Binned G-G Diagram", "Diagramma G-G per velocità"), axes: l("Lateral G → Longitudinal G · colour by speed", "G laterale → G longitudinale · colore per velocità"), explanation: l("Separates mechanical-grip behaviour from the high-speed aerodynamic envelope.", "Separa il comportamento di aderenza meccanica dall'inviluppo aerodinamico ad alta velocità."), formula: "Gx, Gy grouped by speed band", supported: true },
  { id: "brake_deceleration", tier: 1, title: l("Brake Pressure vs Deceleration", "Pressione freno vs decelerazione"), axes: l("Brake pressure → Positive deceleration", "Pressione freno → Decelerazione positiva"), explanation: l("Reveals braking technique, system response and saturation for a given pedal demand.", "Evidenzia tecnica di frenata, risposta del sistema e saturazione rispetto alla richiesta sul pedale."), formula: "decelerationG = −Gx", supported: true },
  { id: "throttle_acceptance", tier: 1, title: l("Throttle Acceptance", "Accettazione acceleratore"), axes: l("Peak lateral G → Grip remaining at 90% throttle", "Picco G laterale → Aderenza residua al 90% acceleratore"), explanation: l("Shows how much peak lateral load remains when the driver commits to power on each corner exit.", "Mostra quanto carico laterale di picco rimane quando il pilota apre il gas in ogni uscita curva."), formula: "acceptance = |Gy at 90% throttle| / peak |Gy| × 100", supported: true },
  { id: "steering_work_lap_time", tier: 1, title: l("Steering Work vs Lap Time", "Lavoro sterzo vs tempo sul giro"), axes: l("Steering activity → Lap time", "Attività sterzo → Tempo sul giro"), explanation: l("Tests whether corrections and excess steering activity correlate with slower laps.", "Verifica se correzioni e attività eccessiva dello sterzo corrispondono a giri più lenti."), formula: "Σ|steering[i] − steering[i−1]|", supported: true },
  { id: "gear_chart", tier: 1, title: l("Gear Chart", "Diagramma marce"), axes: l("Vehicle speed → Engine RPM", "Velocità veicolo → Giri motore"), explanation: l("Checks gearing, shift points and scatter caused by wheelspin or clutch slip.", "Controlla rapporti, punti di cambiata e dispersione dovuta a pattinamento o frizione."), formula: "RPM by speed, grouped by gear", supported: true },
  { id: "curvature_consistency", tier: 1, title: l("Curvature Consistency", "Coerenza curvatura"), axes: l("Lap number → Peak corner curvature", "Numero giro → Curvatura massima curva"), explanation: l("Measures racing-line repeatability for the same corner across a stint.", "Misura la ripetibilità della traiettoria nella stessa curva durante uno stint."), formula: "κ = yawRate / speed or ay / speed²", supported: true },
  { id: "oil_pressure_lateral_g", tier: 1, title: l("Oil Pressure vs Lateral Acceleration", "Pressione olio vs accelerazione laterale"), axes: l("Signed lateral G → Oil pressure", "G laterale con segno → Pressione olio"), explanation: l("Detects pressure loss under sustained lateral load and distinguishes corner direction.", "Rileva cali di pressione sotto carico laterale e distingue la direzione della curva."), formula: "pressure residual vs signed Gy", supported: false, requirements: l("Oil-pressure telemetry", "Telemetria pressione olio") },
  { id: "tyre_temperature_grip", tier: 1, title: l("Tyre Temperature vs Grip", "Temperatura pneumatici vs aderenza"), axes: l("Average tyre temperature → Grip proxy", "Temperatura media pneumatici → Indice di aderenza"), explanation: l("Shows the temperature window associated with the strongest observed grip.", "Mostra la finestra di temperatura associata alla maggiore aderenza osservata."), formula: "temperature bands vs combined G", supported: true },
  { id: "roll_lateral_g", tier: 2, title: l("Roll Angle vs Lateral Acceleration", "Rollio vs accelerazione laterale"), axes: l("Lateral G → Body roll angle", "G laterale → Angolo di rollio"), explanation: l("Estimates effective roll stiffness and the roll gradient in degrees per G.", "Stima la rigidezza effettiva al rollio e il gradiente in gradi per G."), formula: "roll = suspension difference × motion ratio / track", supported: false, requirements: l("Motion ratios and track widths", "Rapporti di movimento e carreggiate") },
  { id: "pitch_longitudinal_g", tier: 2, title: l("Pitch Angle vs Longitudinal Acceleration", "Beccheggio vs accelerazione longitudinale"), axes: l("Longitudinal G → Body pitch angle", "G longitudinale → Angolo di beccheggio"), explanation: l("Shows braking dive, acceleration squat and aerodynamic-platform movement.", "Mostra affondamento in frenata, squat in accelerazione e movimento della piattaforma aerodinamica."), formula: "pitch = atan((rear − front) / wheelbase)", supported: false, requirements: l("Vehicle wheelbase", "Passo del veicolo") },
  { id: "ride_height_speed", tier: 2, title: l("Ride Height vs Speed", "Altezza da terra vs velocità"), axes: l("Vehicle speed → Front and rear ride height", "Velocità veicolo → Altezza anteriore e posteriore"), explanation: l("Exposes aerodynamic compression, platform control and possible bottoming.", "Evidenzia compressione aerodinamica, controllo piattaforma e possibili fondocorsa."), formula: "front/rear ride height by speed", supported: true },
  { id: "front_rear_ride_height", tier: 2, title: l("Front Ride Height vs Rear Ride Height", "Altezza anteriore vs posteriore"), axes: l("Front ride height → Rear ride height", "Altezza anteriore → Altezza posteriore"), explanation: l("Maps the aerodynamic-platform states reached under braking, power and cornering.", "Mappa gli stati della piattaforma aerodinamica in frenata, accelerazione e curva."), formula: "rake = atan((rear − front) / wheelbase)", supported: true },
  { id: "steering_curvature", tier: 2, title: l("Steering Angle vs Curvature", "Angolo sterzo vs curvatura"), axes: l("Road-wheel angle → Curvature", "Angolo ruote → Curvatura"), explanation: l("More steering for the same path curvature indicates increasing understeer.", "Più sterzo per la stessa curvatura indica un aumento del sottosterzo."), formula: "δ = steeringWheel / ratio; κ = yawRate / speed", supported: false, requirements: l("Steering ratio", "Rapporto di sterzo") },
  { id: "steering_yaw_rate", tier: 2, title: l("Steering Angle vs Yaw Rate", "Angolo sterzo vs velocità d'imbardata"), axes: l("Road-wheel angle → Yaw rate", "Angolo ruote → Velocità d'imbardata"), explanation: l("Measures how strongly the vehicle rotates in response to steering input.", "Misura quanto il veicolo ruota in risposta all'input di sterzo."), formula: "yaw gain = yawRate / δ", supported: false, requirements: l("Steering ratio", "Rapporto di sterzo") },
  { id: "steering_lateral_g", tier: 2, title: l("Steering Angle vs Lateral Acceleration", "Angolo sterzo vs accelerazione laterale"), axes: l("Road-wheel angle → Lateral G", "Angolo ruote → G laterale"), explanation: l("More steering without more lateral response reveals front saturation.", "Più sterzo senza maggiore risposta laterale evidenzia saturazione anteriore."), formula: "δ = steeringWheel / steeringRatio", supported: false, requirements: l("Steering ratio", "Rapporto di sterzo") },
  { id: "lap_time_understeer", tier: 3, title: l("Lap Time vs Understeer Angle", "Tempo sul giro vs angolo di sottosterzo"), axes: l("Average understeer angle → Lap time", "Angolo medio di sottosterzo → Tempo sul giro"), explanation: l("Identifies the handling balance in which the driver performs best.", "Identifica il bilanciamento con cui il pilota ottiene la prestazione migliore."), formula: "understeer = δ − wheelbase × yawRate / speed", supported: false, requirements: l("Steering ratio and wheelbase", "Rapporto di sterzo e passo") },
  { id: "handling_diagram", tier: 3, title: l("Handling Diagram", "Diagramma di handling"), axes: l("Lateral G → Front-minus-rear slip", "G laterale → Differenza slip anteriore-posteriore"), explanation: l("Shows front-to-rear balance and which axle approaches saturation first.", "Mostra il bilanciamento tra assi e quale si avvicina prima alla saturazione."), formula: "αfront − αrear ≈ δ − L × yawRate / speed", supported: false, requirements: l("Steering ratio and vehicle geometry", "Rapporto di sterzo e geometria veicolo") },
  { id: "slip_angles_lateral_g", tier: 3, title: l("Front and Rear Slip Angle vs Lateral Acceleration", "Slip anteriore e posteriore vs accelerazione laterale"), axes: l("Lateral G → Front/rear slip angle", "G laterale → Angolo di deriva anteriore/posteriore"), explanation: l("Compares axle slip growth to reveal understeer, balance or oversteer risk.", "Confronta la crescita della deriva sugli assi per evidenziare sottosterzo, equilibrio o rischio sovrasterzo."), formula: "αfront and αrear from δ, β, yaw rate and geometry", supported: false, requirements: l("Steering ratio and vehicle geometry", "Rapporto di sterzo e geometria veicolo") },
  { id: "sideslip_curvature", tier: 3, title: l("Vehicle Sideslip vs Curvature", "Deriva veicolo vs curvatura"), axes: l("Curvature → Vehicle sideslip", "Curvatura → Angolo di deriva veicolo"), explanation: l("Shows how much rotation the driver uses for a given trajectory curvature.", "Mostra quanta rotazione usa il pilota per una data curvatura della traiettoria."), formula: "κ = yawRate / speed; β = atan2(vLat, vLong)", supported: true },
  { id: "sideslip_phase", tier: 3, title: l("Sideslip Phase Plane", "Piano di fase della deriva"), axes: l("Sideslip angle → Sideslip rate", "Angolo di deriva → Velocità di deriva"), explanation: l("Shows whether the vehicle returns toward equilibrium or diverges toward instability.", "Mostra se il veicolo torna verso l'equilibrio o diverge verso l'instabilità."), formula: "β̇ = centralDifference(β, time)", supported: true },
  { id: "dynamic_square", tier: 3, title: l("Dynamic Square", "Quadrato dinamico"), axes: l("Front longitudinal force → Rear longitudinal force", "Forza longitudinale anteriore → posteriore"), explanation: l("Shows brake or drive-force distribution and which axle saturates first.", "Mostra la distribuzione della forza frenante o motrice e quale asse satura per primo."), formula: "axle force = wheel torque / tyre radius", supported: false, requirements: l("Per-wheel force or torque and tyre radius", "Forza o coppia per ruota e raggio pneumatico") },
  { id: "engine_power", tier: 3, title: l("Calculated Engine Power vs RPM", "Potenza motore calcolata vs RPM"), axes: l("Engine RPM → Calculated power", "Giri motore → Potenza calcolata"), explanation: l("Reveals the power curve, high-RPM drop-off and potential shift points.", "Evidenzia curva di potenza, calo agli alti regimi e possibili punti di cambiata."), formula: "powerKW = torque × RPM / 9549", supported: true },
  { id: "wheel_slip_longitudinal", tier: 3, title: l("Wheel Slip Ratio vs Longitudinal Performance", "Slip ruota vs prestazione longitudinale"), axes: l("Wheel slip ratio → Acceleration/force/throttle", "Rapporto di slip → Accelerazione/forza/acceleratore"), explanation: l("Relates tyre slip to output for detecting wheelspin, lockup and control intervention.", "Collega lo slip alla prestazione per rilevare pattinamento, bloccaggio e interventi dei controlli."), formula: "slip = (ωR − speed) / max(speed, ε)", supported: false, requirements: l("Dynamic tyre radius", "Raggio dinamico pneumatico") },
  { id: "speed_steering", tier: 2, title: l("Speed vs Steering Angle", "Velocità vs angolo sterzo"), axes: l("Vehicle speed → Road-wheel angle", "Velocità veicolo → Angolo ruote"), explanation: l("For the same trajectory, steering growth with speed indicates understeer tendency.", "A parità di traiettoria, più sterzo con la velocità indica tendenza al sottosterzo."), formula: "compare δ at matched corner/curvature", supported: false, requirements: l("Steering ratio", "Rapporto di sterzo") },
];

const engineeringGuidance: Record<string, Localized> = {
  gg: l(
    "Look for a broad, smooth and balanced envelope. Flat edges or empty regions can reveal grip limits, intervention or unused capacity; compare left and right lobes for directional imbalance.",
    "Cerca un inviluppo ampio, regolare e bilanciato. Bordi piatti o zone vuote possono indicare limiti di aderenza, interventi o capacità inutilizzata; confronta i lobi destro e sinistro per trovare squilibri direzionali.",
  ),
  speed_binned_gg: l(
    "Compare the envelope between speed bands. Grip should expand at higher speed on an aero car; a band that contracts or becomes asymmetric points to platform, balance or confidence limitations.",
    "Confronta l'inviluppo tra le fasce di velocità. Su una vettura aerodinamica l'aderenza dovrebbe crescere alle alte velocità; una fascia che si restringe o diventa asimmetrica indica limiti di piattaforma, bilanciamento o fiducia.",
  ),
  brake_deceleration: l(
    "Look for a strong, repeatable rise in deceleration with brake demand. A plateau suggests tyre or brake saturation; wide scatter at equal pressure suggests inconsistent grip, technique or ABS activity.",
    "Cerca una crescita forte e ripetibile della decelerazione con la richiesta freno. Un plateau indica saturazione di pneumatici o freni; molta dispersione a pari pressione suggerisce aderenza, tecnica o intervento ABS incoerenti.",
  ),
  throttle_acceptance: l(
    "Higher percentages mean the driver reaches full power while retaining more of the corner's peak lateral load. Compare the same corners across laps; low or scattered values indicate delayed commitment, exit understeer, traction limitation or inconsistent technique.",
    "Percentuali più alte indicano che il pilota raggiunge piena potenza mantenendo più carico laterale rispetto al picco della curva. Confronta le stesse curve tra i giri; valori bassi o dispersi indicano apertura tardiva, sottosterzo in uscita, limiti di trazione o tecnica incoerente.",
  ),
  steering_work_lap_time: l(
    "Fast laps should generally require less steering work. Slower laps with high activity reveal corrections or an unsettled balance; very low activity with slow times may instead indicate under-driving.",
    "I giri veloci dovrebbero generalmente richiedere meno lavoro allo sterzo. Giri lenti con molta attività evidenziano correzioni o un bilanciamento instabile; poca attività con tempi lenti può invece indicare guida conservativa.",
  ),
  gear_chart: l(
    "Each gear should form a clean speed-to-RPM line. Check shift RPM consistency, overlap between gears, time spent beyond peak power and scatter that may indicate wheelspin or clutch slip.",
    "Ogni marcia dovrebbe formare una linea pulita tra velocità e RPM. Controlla la costanza del regime di cambiata, la sovrapposizione dei rapporti, il tempo oltre il picco di potenza e la dispersione dovuta a pattinamento o frizione.",
  ),
  curvature_consistency: l(
    "For the same corner, peak curvature should cluster tightly across valid laps. Outliers or drift through the stint point to changing line choice, tyre degradation, traffic or reduced confidence.",
    "Nella stessa curva, la curvatura massima dovrebbe raggrupparsi strettamente tra i giri validi. Valori anomali o deriva nello stint indicano variazioni di traiettoria, degrado gomme, traffico o minore fiducia.",
  ),
  tyre_temperature_grip: l(
    "Find the temperature band where the highest repeatable grip occurs, not a single peak point. Falling grip on either side suggests under-temperature or overheating; compare tyre groups for imbalance.",
    "Individua la fascia di temperatura in cui compare la massima aderenza ripetibile, non un singolo picco. Un calo ai lati suggerisce temperatura insufficiente o surriscaldamento; confronta i gruppi di pneumatici per trovare squilibri.",
  ),
  ride_height_speed: l(
    "Look for smooth compression as speed and aero load rise. Sudden flattening near minimum height suggests bottoming or a travel limit; front/rear divergence reveals platform and rake changes.",
    "Cerca una compressione regolare con l'aumento di velocità e carico aerodinamico. Un appiattimento improvviso vicino all'altezza minima suggerisce fondo corsa; la divergenza tra anteriore e posteriore rivela variazioni di piattaforma e rake.",
  ),
  front_rear_ride_height: l(
    "Look for compact, repeatable clusters for steady states and clear paths between braking, cornering and power phases. Excessive spread or extreme rake states indicate weak platform control.",
    "Cerca gruppi compatti e ripetibili negli stati stabili e percorsi chiari tra frenata, curva e accelerazione. Dispersione eccessiva o rake estremi indicano scarso controllo della piattaforma.",
  ),
  sideslip_curvature: l(
    "Sideslip should grow progressively with curvature and remain similar left-to-right. Sudden beta growth at modest curvature suggests rear instability; low beta with rising curvature can indicate stable but reluctant rotation.",
    "La deriva dovrebbe crescere progressivamente con la curvatura e restare simile tra destra e sinistra. Una crescita improvvisa di beta con curvatura modesta suggerisce instabilità posteriore; beta basso con curvatura crescente indica rotazione stabile ma riluttante.",
  ),
  sideslip_phase: l(
    "Stable behaviour forms bounded loops that return toward the origin. Expanding loops, long excursions or a rate that drives sideslip farther from zero indicate slow recovery or developing instability.",
    "Un comportamento stabile forma cicli contenuti che tornano verso l'origine. Cicli crescenti, escursioni prolungate o una velocità che allontana ulteriormente la deriva da zero indicano recupero lento o instabilità in sviluppo.",
  ),
  engine_power: l(
    "Look for a smooth rise to a repeatable peak followed by drop-off. The useful shift point is where staying in gear yields less wheel power than the next gear; isolated dips can reveal intervention or poor samples.",
    "Cerca una crescita regolare fino a un picco ripetibile seguita dal calo. Il punto di cambiata utile è dove restare nel rapporto produce meno potenza alla ruota del rapporto successivo; cali isolati possono indicare interventi o campioni anomali.",
  ),
};

const dotMeanings: Record<string, Localized> = {
  gg: l(
    "One filtered telemetry sample. X is signed lateral acceleration; Y is signed longitudinal acceleration. Left/right of zero are opposite cornering directions, below zero is braking and above zero is acceleration.",
    "Un campione telemetrico filtrato. X è l'accelerazione laterale con segno; Y è l'accelerazione longitudinale con segno. A sinistra/destra dello zero ci sono direzioni di curva opposte, sotto lo zero la frenata e sopra lo zero l'accelerazione.",
  ),
  speed_binned_gg: l(
    "One telemetry sample positioned exactly as in the G-G diagram; its colour identifies the vehicle-speed band so the envelopes can be compared.",
    "Un campione telemetrico posizionato come nel diagramma G-G; il colore identifica la fascia di velocità, così gli inviluppi possono essere confrontati.",
  ),
  brake_deceleration: l(
    "One braking sample. Moving right means more brake demand or pressure; moving up means stronger deceleration in G.",
    "Un campione in frenata. Spostarsi a destra significa maggiore richiesta o pressione freno; salire significa maggiore decelerazione in G.",
  ),
  throttle_acceptance: l(
    "One corner exit. X is that corner's peak lateral G; Y is the percentage of that peak still present when throttle first reaches 90%.",
    "Un'uscita di curva. X è il picco di G laterale della curva; Y è la percentuale di quel picco ancora presente quando l'acceleratore raggiunge per la prima volta il 90%.",
  ),
  steering_work_lap_time: l(
    "One completed lap. X totals steering movement and corrections during the lap; Y is its lap time in seconds.",
    "Un giro completato. X somma il movimento dello sterzo e le correzioni durante il giro; Y è il tempo sul giro in secondi.",
  ),
  gear_chart: l(
    "One telemetry sample in a selected gear. X is road speed and Y is engine RPM; points from the same gear form one ratio line.",
    "Un campione telemetrico nella marcia selezionata. X è la velocità e Y il regime motore; i punti della stessa marcia formano la linea di quel rapporto.",
  ),
  curvature_consistency: l(
    "One detected corner on one lap. X is the lap number; Y is peak curvature, where a larger value means a tighter path.",
    "Una curva rilevata in un giro. X è il numero del giro; Y è la curvatura massima, dove un valore maggiore indica una traiettoria più stretta.",
  ),
  tyre_temperature_grip: l(
    "One telemetry sample. X is average tyre temperature and Y is combined lateral-plus-longitudinal G observed at that moment.",
    "Un campione telemetrico. X è la temperatura media degli pneumatici e Y il G combinato laterale-longitudinale osservato in quell'istante.",
  ),
  ride_height_speed: l(
    "One front or rear ride-height sample. X is vehicle speed; Y is distance from the reference floor or chassis point to the ground in millimetres.",
    "Un campione di altezza anteriore o posteriore. X è la velocità; Y è la distanza in millimetri tra il punto di riferimento del fondo o telaio e il suolo.",
  ),
  front_rear_ride_height: l(
    "One simultaneous platform state. X is front ride height and Y is rear ride height, both in millimetres.",
    "Uno stato simultaneo della piattaforma. X è l'altezza anteriore e Y quella posteriore, entrambe in millimetri.",
  ),
  sideslip_curvature: l(
    "One telemetry sample. X is path curvature; Y is vehicle sideslip angle in radians. The signs distinguish the two cornering directions.",
    "Un campione telemetrico. X è la curvatura della traiettoria; Y è l'angolo di deriva del veicolo in radianti. I segni distinguono le due direzioni di curva.",
  ),
  sideslip_phase: l(
    "One telemetry sample. X is current sideslip angle; Y is how quickly that angle is changing. The dot's quadrant shows whether slip is growing or recovering.",
    "Un campione telemetrico. X è l'angolo di deriva attuale; Y indica quanto rapidamente cambia. Il quadrante del punto mostra se la deriva cresce o recupera.",
  ),
  engine_power: l(
    "One near-full-throttle sample. X is engine RPM and Y is calculated engine power in kW from recorded torque.",
    "Un campione vicino al pieno acceleratore. X è il regime motore e Y la potenza calcolata in kW dalla coppia registrata.",
  ),
};

const readingExamples: Record<string, Localized> = {
  gg: l(
    "Example: a dot at X = +1.2 G and Y = −1.5 G is cornering in one direction while braking hard. If the opposite side only reaches −0.9 G, investigate directional imbalance or track-specific sampling.",
    "Esempio: un punto a X = +1,2 G e Y = −1,5 G indica una curva in una direzione durante una forte frenata. Se il lato opposto raggiunge solo −0,9 G, verifica uno squilibrio direzionale o il campionamento del circuito.",
  ),
  speed_binned_gg: l(
    "Example: if the 180+ km/h points reach 2.5 lateral G while the under-100 km/h points reach 1.5 G, the extra envelope is consistent with aerodynamic load. A smaller high-speed envelope deserves investigation.",
    "Esempio: se i punti oltre 180 km/h raggiungono 2,5 G laterali e quelli sotto 100 km/h 1,5 G, l'inviluppo aggiuntivo è coerente con il carico aerodinamico. Un inviluppo più piccolo ad alta velocità va approfondito.",
  ),
  brake_deceleration: l(
    "Example: if pressure continues to rise but the dots stop climbing near 1.8 G, the system has reached a grip or control-system plateau. Compare repeated braking zones before changing setup.",
    "Esempio: se la pressione continua a salire ma i punti smettono di salire vicino a 1,8 G, il sistema ha raggiunto un plateau di aderenza o controllo. Confronta più frenate prima di modificare il setup.",
  ),
  throttle_acceptance: l(
    "Example: Y = 70% means 90% throttle was reached while 70% of peak cornering load remained. For the same corner, 70% indicates earlier commitment than 35%; it is not automatically better if wheelspin follows.",
    "Esempio: Y = 70% significa che il 90% di acceleratore è stato raggiunto mantenendo il 70% del carico laterale di picco. Nella stessa curva, 70% indica un impegno più precoce di 35%, ma non è automaticamente migliore se segue pattinamento.",
  ),
  steering_work_lap_time: l(
    "Example: the useful region is bottom-left—low steering work and low lap time. A dot farther right but at the same time means more corrections were needed; top-left may simply be a slow, conservative lap.",
    "Esempio: la zona utile è in basso a sinistra—poco lavoro allo sterzo e tempo basso. Un punto più a destra con lo stesso tempo richiede più correzioni; in alto a sinistra può essere semplicemente un giro lento e prudente.",
  ),
  gear_chart: l(
    "Example: a clean third-gear line may run from 100 km/h at 5,000 RPM to 160 km/h at 8,000 RPM. Points above that line suggest wheelspin or clutch slip; the line ending repeatedly marks the shift point.",
    "Esempio: una linea pulita in terza può andare da 100 km/h a 5.000 RPM a 160 km/h a 8.000 RPM. Punti sopra la linea suggeriscono pattinamento o frizione; il punto in cui termina ripetutamente indica la cambiata.",
  ),
  curvature_consistency: l(
    "Example: curvature 0.010 1/m corresponds roughly to a 100 m radius; 0.020 1/m is about 50 m. The same corner should stay near one level across laps.",
    "Esempio: una curvatura di 0,010 1/m corrisponde circa a un raggio di 100 m; 0,020 1/m a circa 50 m. La stessa curva dovrebbe restare vicina allo stesso livello tra i giri.",
  ),
  tyre_temperature_grip: l(
    "Example: if comparable high-load samples reach 1.8 G around 90 °C but only 1.3 G around 70 °C, 90 °C is closer to the observed working window. Do not compare a straight-line sample with a cornering sample.",
    "Esempio: se campioni ad alto carico comparabili raggiungono 1,8 G intorno a 90 °C ma solo 1,3 G a 70 °C, 90 °C è più vicina alla finestra osservata. Non confrontare un campione in rettilineo con uno in curva.",
  ),
  ride_height_speed: l(
    "Example: 50 mm at 100 km/h and 35 mm at 250 km/h means 15 mm of compression. A dense horizontal band at the minimum height can indicate bottoming or a travel stop.",
    "Esempio: 50 mm a 100 km/h e 35 mm a 250 km/h significano 15 mm di compressione. Una fascia orizzontale densa all'altezza minima può indicare contatto col fondo o un fine corsa.",
  ),
  front_rear_ride_height: l(
    "Example: X = 40 mm and Y = 55 mm means the rear is 15 mm higher than the front at that instant. Horizontal movement is mainly front change; vertical movement is mainly rear change.",
    "Esempio: X = 40 mm e Y = 55 mm significa che il posteriore è 15 mm più alto dell'anteriore in quell'istante. Il movimento orizzontale è soprattutto anteriore; quello verticale soprattutto posteriore.",
  ),
  sideslip_curvature: l(
    "Example: 0.05 rad is about 2.9°. If sideslip suddenly doubles while curvature barely changes, the rear is rotating more than the path requires. Compare mirrored quadrants for left/right consistency.",
    "Esempio: 0,05 rad sono circa 2,9°. Se la deriva raddoppia mentre la curvatura cambia poco, il posteriore ruota più di quanto richieda la traiettoria. Confronta i quadranti speculari per la coerenza destra/sinistra.",
  ),
  sideslip_phase: l(
    "Example: X = +0.04 rad and Y = −0.20 rad/s means positive sideslip is reducing—recovery. If X and Y are both positive, sideslip is still growing; repeated expanding loops indicate weaker stability.",
    "Esempio: X = +0,04 rad e Y = −0,20 rad/s significa che la deriva positiva si sta riducendo—recupero. Se X e Y sono entrambi positivi, la deriva cresce ancora; cicli che si espandono indicano minore stabilità.",
  ),
  engine_power: l(
    "Example: if power peaks at 450 kW near 7,500 RPM and falls to 420 kW by 8,500 RPM, revving farther gives less engine power. The best shift RPM still depends on the next gear's ratio.",
    "Esempio: se la potenza raggiunge 450 kW vicino a 7.500 RPM e scende a 420 kW a 8.500 RPM, salire ancora di regime produce meno potenza. Il regime di cambiata migliore dipende comunque dal rapporto successivo.",
  ),
};

export const xyPlotCatalog: XYPlotDefinition[] = plotDefinitions.map((definition) => ({
  ...definition,
  dotMeaning: dotMeanings[definition.id],
  whatToLookFor: engineeringGuidance[definition.id],
  example: readingExamples[definition.id],
}));

export function localize(value: Localized, language: Language) {
  return value[language] || value.en;
}
