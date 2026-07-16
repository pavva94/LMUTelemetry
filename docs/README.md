# LMU Telemetry Documentation

This documentation set explains how the application is built, how data moves through it, and how every major page or graph calculates its values.

- [Architecture](architecture.md): runtime components, API surface, session rotation, and frontend routing.
- [Data Handling](data-handling.md): live telemetry normalization, DuckDB cache behavior, storage, pause rules, and saved reviews.
- [Live Strategy Calculations](live-strategy-calculations.md): fuel, tyre, stint, pit-window, competitor, and recommendation rules.
- [Page And Graph Calculations](page-and-graph-calculations.md): frontend page-by-page formula reference for live, review, race-prep, and engineering views.
- [Monte Carlo Race Simulation](monte-carlo-simulation.md): data filtering, model variables, equations, parameters, risk definitions, outputs, and limitations.
