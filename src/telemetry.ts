import { config } from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

config();

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otlpHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;

// Only export traces if OTLP endpoint is configured
// Otherwise, disable tracing to avoid console spam
const traceExporter = otlpEndpoint ? new OTLPTraceExporter() : undefined;

// Only initialize OpenTelemetry if OTLP endpoint is configured
// This prevents console spam from ConsoleSpanExporter
let sdk: NodeSDK | undefined;
if (traceExporter) {
  sdk = new NodeSDK({
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log(`OpenTelemetry initialized - exporting to Grafana at ${otlpEndpoint}`);
  console.log(`Resource attributes: ${process.env.OTEL_RESOURCE_ATTRIBUTES || 'none'}`);
} else {
  console.log('OpenTelemetry disabled - set OTEL_EXPORTER_OTLP_ENDPOINT to enable tracing');
}

export { sdk };
