import { NextRequest, NextResponse } from "next/server";
import * as k8s from "@kubernetes/client-node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAMESPACE = process.env.SCALE_TARGET_NAMESPACE || "default";
const DEPLOYMENT =
  process.env.SCALE_TARGET_DEPLOYMENT || "autoscaling-dashboard";
const MAX_REPLICAS = Number(process.env.MAX_REPLICAS || 5);

function getClients() {
  const kc = new k8s.KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }

  return {
    appsApi: kc.makeApiClient(k8s.AppsV1Api) as any,
    coreApi: kc.makeApiClient(k8s.CoreV1Api) as any,
  };
}

function bodyOf(res: any) {
  return res?.body ?? res;
}

function isPodReady(pod: any) {
  return Boolean(
    pod?.status?.conditions?.some(
      (condition: any) =>
        condition.type === "Ready" && condition.status === "True",
    ),
  );
}

async function getScaleStatus() {
  const { appsApi, coreApi } = getClients();

  const deploymentRes = await appsApi.readNamespacedDeployment({
    name: DEPLOYMENT,
    namespace: NAMESPACE,
  });

  const deployment = bodyOf(deploymentRes);

  const podsRes = await coreApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: `app=${DEPLOYMENT}`,
  });

  const pods = bodyOf(podsRes);
  const podItems = pods?.items ?? [];

  const desiredReplicas = deployment?.spec?.replicas ?? 0;
  const availableReplicas = deployment?.status?.availableReplicas ?? 0;
  const readyReplicas = deployment?.status?.readyReplicas ?? 0;

  return {
    ok: true,
    namespace: NAMESPACE,
    deployment: DEPLOYMENT,
    desiredReplicas,
    availableReplicas,
    readyReplicas,
    currentReplicas: desiredReplicas,
    pods: podItems.map((pod: any) => ({
      name: pod.metadata?.name ?? "unknown",
      phase: pod.status?.phase ?? "Unknown",
      ready: isPodReady(pod),
      podIP: pod.status?.podIP,
      nodeName: pod.spec?.nodeName,
    })),
  };
}

async function scaleDeployment(replicas: number) {
  const { appsApi } = getClients();

  const scaleRes = await appsApi.readNamespacedDeploymentScale({
    name: DEPLOYMENT,
    namespace: NAMESPACE,
  });

  const scale = bodyOf(scaleRes);

  scale.spec = {
    ...(scale.spec ?? {}),
    replicas,
  };

  const replaceRes = await appsApi.replaceNamespacedDeploymentScale({
    name: DEPLOYMENT,
    namespace: NAMESPACE,
    body: scale,
  });

  return bodyOf(replaceRes);
}

export async function GET() {
  try {
    const status = await getScaleStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        namespace: NAMESPACE,
        deployment: DEPLOYMENT,
        error:
          error?.message ??
          "Failed to read Kubernetes deployment scale status.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const replicas = Number(body.replicas);

    if (!Number.isFinite(replicas)) {
      return NextResponse.json(
        { ok: false, error: "replicas must be a number" },
        { status: 400 },
      );
    }

    const safeReplicas = Math.max(
      1,
      Math.min(MAX_REPLICAS, Math.round(replicas)),
    );

    await scaleDeployment(safeReplicas);

    const status = await getScaleStatus();

    return NextResponse.json({
      ok: true,
      requestedReplicas: safeReplicas,
      namespace: NAMESPACE,
      deployment: DEPLOYMENT,
      message: `Requested EKS scale to ${safeReplicas} replicas`,
      status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        namespace: NAMESPACE,
        deployment: DEPLOYMENT,
        error: error?.message ?? "Failed to request Kubernetes scale.",
      },
      { status: 500 },
    );
  }
}
