# Telemetry XY Plots

A documentation reference for the most useful XY plots in race-car telemetry analysis.

Each section defines the axes, calculation, purpose, interpretation, and important limitations.

## Common notation

| Name | Meaning | Unit |
|---|---|---|
| `ax`, `ay` | Longitudinal and lateral acceleration | m/s² |
| `Gx = ax / 9.81` | Longitudinal acceleration | g |
| `Gy = ay / 9.81` | Lateral acceleration | g |
| `v` | Vehicle speed | m/s |
| `r` | Yaw rate | rad/s |
| `deltaSW` | Steering-wheel angle | deg or rad |
| `delta = deltaSW / steeringRatio` | Road-wheel steering angle | rad |
| `beta` | Vehicle body sideslip angle | rad |
| `kappa` | Trajectory curvature | 1/m |
| `L` | Wheelbase | m |
| `a`, `b` | CG-to-front and CG-to-rear axle distances | m |
| `m` | Vehicle mass | kg |

## General processing rules

- Resample required channels to a common timebase.
- Remove invalid laps, pit-lane data, missing samples, and impossible values.
- Apply light filtering before calculating derivatives.
- Use a minimum speed threshold in equations containing division by speed.
- Compare similar tyres, fuel loads, setups, and track conditions.
- Label estimated channels separately from measured channels.
- Filter by corner and speed before interpreting handling behaviour.

---

## 1. G-G Diagram

**X:** `Gy`  
**Y:** `Gx`

```text
combinedG = sqrt(Gx² + Gy²)
```

Shows the vehicle acceleration envelope and how tyre grip is divided between braking, acceleration, and cornering.

**Interpretation**

- Rounded transitions indicate good combined-grip use and trail braking.
- A square or cross-shaped distribution indicates separated braking, turning, and acceleration phases.
- A larger high-speed envelope may indicate aerodynamic downforce.
- Left/right asymmetry can come from the circuit, setup, or driver.

**Recommended filters:** speed, corner, driver, tyre age, fuel load, and valid laps.

---

## 2. Speed-Binned G-G Diagram

**X:** `Gy`  
**Y:** `Gx`  
**Series or colour:** vehicle-speed band

Use the normal G-G data and divide samples into speed ranges.

```text
0-80 km/h
80-140 km/h
140-200 km/h
Above 200 km/h
```

Separates low-speed mechanical grip from high-speed aerodynamic grip.

A growing high-speed envelope suggests useful downforce. A reduced high-speed envelope can indicate platform-control problems, aero stall, or insufficient driver confidence.

---

## 3. Brake Pressure vs Deceleration

**X:** brake pressure or brake position  
**Y:** positive deceleration

```text
decelerationG = -Gx
brakeEfficiency = decelerationG / brakePressure
```

Use only samples above a minimum brake threshold.

Shows the relationship between driver brake demand and actual deceleration.

**Interpretation**

- High pressure without additional deceleration suggests tyre saturation or ABS intervention.
- Variable deceleration at the same pressure can be caused by speed, aero load, grip, gradient, or bumps.
- Different driver clusters reveal different braking techniques.
- A large application/release loop may reveal hysteresis and transient load transfer.

Colour by speed because aerodynamic load affects braking performance.

---

## 4. Throttle Acceptance

**X:** `abs(Gy)`  
**Y:** throttle position

Use corner-exit samples only.

```text
peakGy = max(abs(Gy)) within corner
GyAt90Throttle = abs(Gy) when throttle first reaches 90%
throttleAcceptance = GyAt90Throttle / peakGy
```

Measures how much lateral load remains when the driver commits to power.

A low value may indicate caution, poor rear traction, wheelspin, tyre degradation, or instability. A high value indicates aggressive blending of cornering and acceleration.

A higher score is not automatically better because some corners require delayed throttle for positioning.

---

## 5. Steering Work vs Lap Time

**X:** steering-work metric  
**Y:** lap time or corner time

Basic metric:

```text
steeringWork = integral(abs(deltaSW), dt)
```

Preferred correction-focused metric:

```text
steeringActivity = integral(abs(derivative(deltaSW)), dt)
```

Discrete form:

```text
steeringActivity = sum(abs(deltaSW[i] - deltaSW[i - 1]))
```

Shows whether excessive steering activity correlates with slower performance.

Higher activity on slower laps may indicate corrections, entry-speed problems, oversteer, poor damping, or an inconsistent line.

Compare the same driver and the same corner or track layout.

---

## 6. Lap Time vs Understeer Angle

**X:** average understeer angle  
**Y:** lap time or corner time

```text
kinematicSteer = L * r / v
understeerAngle = delta - kinematicSteer
averageUndersteer = mean(understeerAngle)
```

Use quasi-steady cornering samples.

Shows the balance in which a driver performs best.

- Positive values generally indicate understeer.
- Values near zero indicate approximately neutral behaviour.
- Negative values indicate additional rotation or oversteer.

Control fuel, tyres, traffic, and track evolution because this is a correlation, not proof of causation.

---

## 7. Curvature Consistency

**X:** lap number  
**Y:** peak or average curvature for one corner

Preferred calculation:

```text
kappa = r / v
```

Alternative:

```text
kappa = ay / v²
kappa = Gy * 9.81 / v²
```

Corner metrics:

```text
peakCurvature = max(abs(kappa))
averageCurvature = mean(abs(kappa))
```

Measures the repeatability of the driver's path through the same corner.

- Tight clusters indicate consistency.
- Large scatter indicates line variation or changing conditions.
- Gradual trends may show tyre degradation, fuel effects, or driver adaptation.
- Sudden shifts may indicate traffic, incidents, or setup changes.

Curvature does not fully describe spatial position; GPS trajectory data is more complete.

---

## 8. Vehicle Sideslip vs Curvature

**X:** `kappa`  
**Y:** `beta`

```text
kappa = r / v
beta = atan2(lateralVelocity, longitudinalVelocity)
```

GPS alternative:

```text
beta = velocityHeading - vehicleHeading
```

Shows how much the vehicle rotates for a given turning intensity.

Greater sideslip at the same curvature indicates more rotation. Rapidly increasing sideslip can indicate rear saturation.

Reliable sideslip requires velocity direction, body heading, or a state estimator.

---

## 9. Steering Angle vs Curvature

**X:** road-wheel steering angle, `delta`  
**Y:** curvature, `kappa`

```text
delta = deltaSW / steeringRatio
kappa = r / v
deltaKinematic = L * kappa
```

Shows how much steering is required to generate a particular path curvature.

- More steering for the same curvature indicates increasing understeer.
- Less steering indicates stronger rotation.
- A flat response can indicate front saturation.
- Colour by speed to reveal speed-dependent balance.

Use quasi-steady samples with low steering rate, low yaw acceleration, and no kerb impacts.

---

## 10. Speed vs Steering Angle

**X:** vehicle speed  
**Y:** road-wheel steering angle

Filter by one corner or a narrow curvature range.

For approximately constant radius:

- Steering increasing with speed indicates understeer tendency.
- Steering decreasing with speed indicates oversteer tendency.
- A break in the trend may indicate saturation or instability.

Without curvature filtering, the plot mainly shows that slow, tight corners require more steering.

---

## 11. Handling Diagram

**X:** `ay / 9.81`  
**Y:** front-minus-rear slip-angle difference

```text
alphaFront = delta - beta - (a * r / v)
alphaRear = -beta + (b * r / v)
slipAngleDifference = alphaFront - alphaRear
```

Simplified form:

```text
slipAngleDifference ≈ delta - L * r / v
```

Describes front-to-rear balance as lateral acceleration increases.

- Increasing difference indicates understeer.
- A nearly constant difference indicates approximately neutral balance.
- A decreasing trend indicates increasing rear-slip dominance.
- Strong non-linearity can show one axle approaching saturation.

Sign conventions must be documented and validated.

---

## 12. Sideslip Phase Plane

**X:** sideslip angle, `beta`  
**Y:** sideslip rate, `betaDot`

```text
betaDot[i] =
    (beta[i + 1] - beta[i - 1]) /
    (time[i + 1] - time[i - 1])
```

Shows whether lateral motion returns towards equilibrium or diverges towards a spin.

- Motion towards the origin indicates recovery.
- Motion away from the origin indicates divergence.
- Large `beta` with same-sign `betaDot` means the slide is growing.
- Large `beta` with opposite-sign `betaDot` means the car is recovering.

Compare similar speed and steering conditions.

---

## 13. Roll Angle vs Lateral Acceleration

**X:** `Gy`  
**Y:** body roll angle

```text
frontRoll =
    (suspLF - suspRF) *
    frontMotionRatio /
    frontTrack

rearRoll =
    (suspLR - suspRR) *
    rearMotionRatio /
    rearTrack

roll =
    frontWeight * frontRoll +
    rearWeight * rearRoll

rollDegrees = rollRadians * 180 / pi
```

Fit:

```text
roll = offset + rollGradient * Gy
```

Measures effective roll stiffness.

- Lower slope means a stiffer roll response.
- Higher slope means a softer response.
- Hysteresis can indicate damping or friction.
- A changed slope may indicate setup, tyre-pressure, or mechanical changes.

Suspension channels must be zeroed and converted using the correct motion ratio.

---

## 14. Pitch Angle vs Longitudinal Acceleration

**X:** `Gx`  
**Y:** body pitch angle

```text
frontAverage = (suspLF + suspRF) / 2
rearAverage = (suspLR + suspRR) / 2
pitch = atan((rearAverage - frontAverage) / L)
```

Fit:

```text
pitch = offset + pitchGradient * Gx
```

Measures braking dive, acceleration squat, and aerodynamic-platform movement.

Large pitch changes can alter ride heights and aerodynamic balance. Also plot front and rear ride heights separately because pitch alone can hide heave motion.

---

## 15. Gear Chart

**X:** vehicle speed  
**Y:** engine RPM  
**Series or colour:** selected gear

```text
engineRPM =
    vehicleSpeedMps *
    60 *
    gearRatio *
    finalDriveRatio /
    (2 * pi * dynamicTyreRadius)
```

Alternative:

```text
speedKmh =
    0.377 *
    dynamicTyreRadius *
    engineRPM /
    (gearRatio * finalDriveRatio)
```

Each gear should form an approximately straight line.

- RPM above the expected line can indicate clutch slip or wheelspin.
- Reaching the limiter early can indicate short gearing.
- Unused RPM range may indicate poor gear selection or shift strategy.
- Discontinuities identify shifts.

Use individual wheel speeds for detailed lockup analysis.

---

## 16. Calculated Engine Power vs RPM

**X:** engine RPM  
**Y:** calculated power

When engine torque is available:

```text
powerW =
    engineTorque *
    2 *
    pi *
    engineRPM /
    60

powerKW =
    engineTorque *
    engineRPM /
    9549
```

Track-derived estimate:

```text
dragForce = 0.5 * airDensity * CdA * v²
rollingForce = Crr * m * 9.81
gradeForce = m * 9.81 * sin(roadGradient)

tractiveForce =
    m * ax +
    dragForce +
    rollingForce +
    gradeForce

wheelPower = tractiveForce * v
enginePower = wheelPower / drivelineEfficiency
```

Shows peak power, power drop-off, possible engine limitations, and candidate shift points.

Use only full-throttle, stable-gear, low-wheelspin, low-curvature samples.

---

## 17. Tyre Temperature vs Grip

**X:** tyre temperature  
**Y:** grip proxy

```text
averageTyreTemperature =
    (innerTemperature +
     middleTemperature +
     outerTemperature) / 3

innerOuterSpread =
    innerTemperature -
    outerTemperature
```

Possible grip proxies:

```text
abs(Gy)
combinedG
cornerMinimumSpeed
cornerPeakGy
```

Estimates the temperature range associated with the highest available tyre performance.

Raw scatter is affected by corner radius, speed, downforce, fuel, tyre age, and driver effort. Prefer the same corner and similar conditions, using a 90th or 95th percentile grip envelope within temperature bins.

---

## 18. Oil Pressure vs Lateral Acceleration

**X:** signed `Gy`  
**Y:** oil pressure

Optional residual:

```text
oilPressureResidual =
    measuredOilPressure -
    expectedOilPressure(engineRPM, oilTemperature)
```

Checks whether oil pressure remains stable under lateral load.

- A pressure drop only in one `Gy` direction indicates a direction-specific issue.
- A pressure drop at high absolute `Gy` in both directions suggests a general pickup or oil-level problem.
- A stronger problem at high oil temperature can indicate viscosity or capacity limitations.

Preserve the sign of `Gy`.

---

## 19. Dynamic Square

**X:** front-axle longitudinal force  
**Y:** rear-axle longitudinal force

From wheel torque:

```text
frontForce =
    (torqueFL + torqueFR) /
    dynamicTyreRadius

rearForce =
    (torqueRL + torqueRR) /
    dynamicTyreRadius
```

Approximation:

```text
totalLongitudinalForce =
    m * ax +
    resistanceForces

frontForce =
    forceDistribution *
    totalLongitudinalForce

rearForce =
    (1 - forceDistribution) *
    totalLongitudinalForce
```

Combined tyre-force constraint:

```text
(Fx / (muX * Fz))^n +
(Fy / (muY * Fz))^n <= 1
```

Evaluates brake or drive-force distribution while the tyres also generate lateral force.

The preferred distribution prevents one axle from saturating much earlier than the other.

Requires wheel torque, tyre-force channels, or a detailed model.

---

## 20. Wheel Slip Ratio vs Longitudinal Performance

**X:** wheel slip ratio  
**Y:** longitudinal acceleration, force, or throttle

Acceleration convention:

```text
slipRatio =
    (wheelAngularSpeed * tyreRadius - vehicleSpeed) /
    max(vehicleSpeed, epsilon)
```

Braking convention:

```text
slipRatio =
    (vehicleSpeed - wheelAngularSpeed * tyreRadius) /
    max(vehicleSpeed, epsilon)
```

Shows how tyre slip relates to longitudinal performance.

- Force increasing with slip means operation below peak slip.
- A plateau indicates the optimum region.
- Falling force while slip increases indicates wheelspin or lockup.
- Left/right differences can indicate load transfer, differential behaviour, or surface differences.

Use one sign convention consistently.

---

## 21. Steering Angle vs Lateral Acceleration

**X:** road-wheel steering angle  
**Y:** `Gy`

```text
delta = deltaSW / steeringRatio
```

Shows lateral response for a given steering input.

- More steering for the same lateral acceleration indicates understeer.
- Increasing steering without more lateral acceleration indicates front saturation.
- Loops can reveal entry/exit hysteresis.

Filter or colour by speed.

---

## 22. Steering Angle vs Yaw Rate

**X:** road-wheel steering angle  
**Y:** yaw rate

```text
yawGain = yawRate / delta
normalisedYawRate = yawRate / vehicleSpeed
```

Shows how strongly the vehicle rotates in response to steering.

- Reduced yaw response can indicate understeer.
- Excessive response can indicate oversteer.
- Delayed response can indicate compliance or damping effects.
- Oscillation can indicate instability or repeated corrections.

Use speed bands or compare the same corner.

---

## 23. Front and Rear Slip Angle vs Lateral Acceleration

**X:** `ay / 9.81`  
**Y series:** `alphaFront`, `alphaRear`

```text
alphaFront =
    delta -
    beta -
    (a * r / v)

alphaRear =
    -beta +
    (b * r / v)
```

Shows which axle builds and saturates slip angle first.

- Front saturation first indicates understeer.
- Rear slip growing faster indicates oversteer risk.
- Similar trends indicate a relatively balanced car.

Requires reliable vehicle geometry and sideslip estimation.

---

## 24. Ride Height vs Speed

**X:** vehicle speed  
**Y:** front and rear ride height

```text
frontRideHeight =
    staticFrontHeight -
    (suspLF + suspRF) / 2

rearRideHeight =
    staticRearHeight -
    (suspLR + suspRR) / 2
```

Approximate aerodynamic load:

```text
aeroLoad =
    0.5 *
    airDensity *
    ClA *
    v²
```

Shows aerodynamic compression and platform control.

It can expose bump-stop contact, floor contact, excessive ride-height reduction, strong rake changes, and non-linear platform behaviour.

Separate straight-line, braking, and cornering states.

---

## 25. Front Ride Height vs Rear Ride Height

**X:** front ride height  
**Y:** rear ride height

```text
rakeAngle =
    atan(
        (rearRideHeight - frontRideHeight) /
        L
    )
```

Maps the aerodynamic-platform states reached during a lap.

Colour by speed, brake pressure, throttle, lateral acceleration, or corner to identify platform regions associated with poor stability or performance.

---

# Implementation Priority

## Tier 1: Common telemetry channels

1. G-G diagram
2. Speed-binned G-G diagram
3. Brake pressure vs deceleration
4. Throttle acceptance
5. Steering work vs lap time
6. Gear chart
7. Curvature consistency
8. Oil pressure vs lateral acceleration
9. Tyre temperature vs grip
10. Wheel slip ratio vs longitudinal performance, when wheel speeds are available

## Tier 2: Suspension or vehicle parameters required

1. Roll angle vs lateral acceleration
2. Pitch angle vs longitudinal acceleration
3. Ride height vs speed
4. Front ride height vs rear ride height
5. Steering angle vs curvature
6. Steering angle vs yaw rate
7. Steering angle vs lateral acceleration
8. Speed vs steering angle

## Tier 3: Estimated channels or models required

1. Lap time vs understeer angle
2. Handling diagram
3. Front and rear slip angle vs lateral acceleration
4. Vehicle sideslip vs curvature
5. Sideslip phase plane
6. Dynamic square
7. Calculated engine power when torque is unavailable

# Shared Plot Requirements

Every plot should provide, where applicable:

- Axis names and units
- Raw-value tooltip
- Driver, lap, and setup comparison
- Corner filter
- Speed-range filter
- Valid-lap filter
- Tyre-compound and tyre-age filters
- Fuel-load filter
- Session-phase filter
- Visible sample count
- Optional trend line
- Optional regression statistics
- Optional percentile envelope
- Colouring by speed, lap, throttle, brake, or tyre state
- PNG export
- CSV export
- Missing-channel warning
- Estimated-channel warning
- Formula description
- Interpretation guidance
- Warning about common interpretation errors

The application must not silently calculate a plot when required channels, units, or vehicle parameters are missing.
