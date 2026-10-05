# IoT Integration — Scope Decision

## Status: Out of Scope (v3.0)

The GACP Digital Platform **does not include IoT sensor integration** in version 3.0. This is a deliberate architectural decision, not an omission.

## Rationale

| Factor | Decision |
|--------|----------|
| **Target users** | Small-to-medium Thai herb Applicants who primarily use smartphones |
| **Cost** | IoT sensor hardware + connectivity would increase deployment cost significantly |
| **Infrastructure** | Most target farm locations lack reliable internet connectivity for IoT |
| **Regulatory** | Thai FDA GACP standards currently require manual inspection, not automated sensor data |
| **Complexity** | Adding IoT would require MQTT broker, time-series DB, and device management — significant scope increase |

## What Exists Instead

The platform handles environmental data via **manual entry forms** in the Planting Cycle module:

- Soil type (manual selection)
- Irrigation type (manual selection)
- Environmental observations (text notes)
- Photo evidence (smartphone camera uploads via MinIO)

## Future Consideration (v4.0+)

If IoT integration is needed in the future, the recommended approach would be:

1. **MQTT broker** (e.g., Mosquitto) as a new Docker service
2. **Time-series database** (e.g., TimescaleDB extension on existing PostgreSQL)
3. **REST API endpoints** for sensor data ingestion at `/api/iot/ingest`
4. **Device provisioning** with API key per sensor device
5. **Dashboard widgets** showing real-time sensor charts on the Planting Cycle detail page

The current schema already has `PlantingCycle` and `PlantingCyclePlot` models that could be extended with sensor data relationships.
