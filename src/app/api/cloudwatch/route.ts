import { NextResponse } from "next/server";
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-2";
const CLUSTER_NAME = process.env.EKS_CLUSTER_NAME || "ai-autoscaling-demo";
const NAMESPACE = process.env.EKS_NAMESPACE || "default";
const POD_NAME = process.env.EKS_POD_NAME || "autoscaling-dashboard";
const ALB_LOAD_BALANCER =
  process.env.ALB_LOAD_BALANCER ||
  "app/ai-autoscaling-dashboard-alb/93f04c724dbbcd79";

const cloudwatch = new CloudWatchClient({
  region: REGION,
});

function latest(values?: number[]) {
  if (!values || values.length === 0) return 0;
  return Number(values[values.length - 1] ?? 0);
}

function podMetricQuery(
  id: string,
  metricName: string,
  stat: "Average" | "Maximum" | "Sum" = "Average",
): MetricDataQuery {
  return {
    Id: id,
    MetricStat: {
      Metric: {
        Namespace: "ContainerInsights",
        MetricName: metricName,
        Dimensions: [
          { Name: "PodName", Value: POD_NAME },
          { Name: "ClusterName", Value: CLUSTER_NAME },
          { Name: "Namespace", Value: NAMESPACE },
        ],
      },
      Period: 60,
      Stat: stat,
    },
    ReturnData: true,
  };
}

function albMetricQuery(
  id: string,
  metricName: string,
  stat: "Average" | "Maximum" | "Sum" | "p95" = "Average",
): MetricDataQuery {
  return {
    Id: id,
    MetricStat: {
      Metric: {
        Namespace: "AWS/ApplicationELB",
        MetricName: metricName,
        Dimensions: [
          {
            Name: "LoadBalancer",
            Value: ALB_LOAD_BALANCER,
          },
        ],
      },
      Period: 60,
      Stat: stat,
    },
    ReturnData: true,
  };
}

export async function GET() {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

    const result = await cloudwatch.send(
      new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: endTime,
        MetricDataQueries: [
          podMetricQuery("cpu", "pod_cpu_utilization", "Average"),
          podMetricQuery("mem", "pod_memory_utilization", "Average"),
          podMetricQuery("podmem", "pod_memory_working_set", "Average"),

          albMetricQuery("albreq", "RequestCount", "Sum"),
          albMetricQuery("alblat", "TargetResponseTime", "Average"),
        ],
      }),
    );

    const cpuPercent = latest(
      result.MetricDataResults?.find((m) => m.Id === "cpu")?.Values,
    );

    const memoryPercent = latest(
      result.MetricDataResults?.find((m) => m.Id === "mem")?.Values,
    );

    const podMemBytes = latest(
      result.MetricDataResults?.find((m) => m.Id === "podmem")?.Values,
    );

    const albRequestCount = latest(
      result.MetricDataResults?.find((m) => m.Id === "albreq")?.Values,
    );

    const albTargetResponseTimeSeconds = latest(
      result.MetricDataResults?.find((m) => m.Id === "alblat")?.Values,
    );

    const podMemMi = podMemBytes
      ? Math.round(podMemBytes / 1024 / 1024)
      : Math.round(memoryPercent * 10);

    const requests = Math.max(1, Math.round(albRequestCount / 60));

    const responseTimeMs = Math.max(
      50,
      Math.round(albTargetResponseTimeSeconds * 1000),
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),

      requests,
      response_time_ms: responseTimeMs,

      cpu_percent: Math.round(cpuPercent),
      memory_percent: Math.round(memoryPercent),

      node_cpu_millicores: Math.round(cpuPercent * 20),
      pod_cpu_millicores: Math.round(cpuPercent * 10),
      pod_mem_mi: podMemMi,

      replicas: 1,
      desired_replicas: 1,
      available_replicas: 1,

      source: "CloudWatch EKS + ALB metrics",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          "Failed to fetch CloudWatch metrics. Check ALB, Container Insights, and IAM permissions.",
      },
      { status: 500 },
    );
  }
}
