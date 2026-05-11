# AI Predictive Autoscaling Cloud Dashboard

A cloud monitoring and predictive autoscaling dashboard built with the **T3 Stack**, **AWS EKS**, **Kubernetes**, and a **Python ML backend**. The dashboard observes workload metrics in real time and uses a lightweight ML layer to recommend scaling actions before traditional reactive HPA rules would normally trigger.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Frontend (Next.js)](#frontend-nextjs)
  - [ML Backend (FastAPI)](#ml-backend-fastapi)
  - [Running Everything Locally](#running-everything-locally)
- [Docker](#docker)
- [Kubernetes on AWS EKS](#kubernetes-on-aws-eks)
- [Load Testing](#load-testing)
- [AWS Cleanup](#aws-cleanup)
- [Git Hygiene](#git-hygiene)
- [Project Summary](#project-summary)

---

## Overview

This project was built as a cloud computing demo on **AWS EKS**.

The dashboard surfaces the metrics that matter for autoscaling decisions — request traffic, p95 latency, CPU and memory usage, current pod count, and live HPA status. After the EKS deployment was stable, a **Python FastAPI** service was added on top to act as the AI layer: it ingests these metrics and returns a scaling recommendation (`scale_up`, `scale_down`, or `stable`) along with a confidence score and a suggested replica count.

The goal is to show how a cloud workload can move from **reactive** scaling (HPA reacting to thresholds) toward **predictive** scaling (ML anticipating load).

---

## Features

- Real-time cloud dashboard built with Next.js and Tailwind
- Full T3 Stack project structure with tRPC and TypeScript
- AWS EKS-ready Kubernetes manifests (Deployment, Service, Ingress, HPA)
- k6 load testing scripts for traffic simulation
- Live metrics: traffic, latency, CPU, memory, pod count, scaling state
- FastAPI ML backend with Random Forest and XGBoost models
- Predictive scaling recommendation API with confidence scores
- Independent Dockerfiles for the frontend and ML service
- Clean separation of concerns: UI ↔ tRPC ↔ ML API

---

## Tech Stack

### Frontend

- Next.js (App Router)
- TypeScript
- T3 Stack
- tRPC
- Tailwind CSS

### ML Backend

- Python 3
- FastAPI + Uvicorn
- scikit-learn
- XGBoost
- joblib

### Cloud / DevOps

- AWS EKS
- Kubernetes (`kubectl`, `eksctl`)
- AWS CLI
- Docker
- k6

---

## Architecture

```txt
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Next.js (T3)    │ ───▶ │  FastAPI ML API  │ ───▶ │  Trained Models  │
│  Dashboard UI    │      │  /predict        │      │  RF / XGBoost    │
└──────────────────┘      └──────────────────┘      └──────────────────┘
        │                          ▲
        │                          │
        ▼                          │
┌──────────────────────────────────┴───────────────────────────────────┐
│                   Kubernetes on AWS EKS                              │
│  Deployments • Services • Ingress • Horizontal Pod Autoscaler        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```txt
cloud-dashboard/
├── src/
│   ├── app/                     # Next.js App Router pages and routes
│   ├── scaling-ml/              # Python FastAPI ML backend
│   │   └── api/
│   │       ├── main.py          # FastAPI entry point
│   │       ├── feature_builder.py
│   │       ├── requirements.txt
│   │       ├── Dockerfile
│   │       └── models/
│   │           ├── random_forest.joblib
│   │           └── xgboost.joblib
│   ├── styles/
│   └── env.js
├── k8s/                         # Kubernetes manifests
├── public/
├── load-test.js                 # k6 load test
├── Dockerfile                   # Frontend image
├── package.json
├── next.config.js
├── tsconfig.json
└── README.md
```

> `venv/` and `__pycache__/` should never be committed — see [Git Hygiene](#git-hygiene).

---

## Getting Started

### Frontend (Next.js)

```bash
npm install
npm run dev
```

Dashboard runs at: `http://localhost:3000`

### ML Backend (FastAPI)

```bash
cd src/scaling-ml/api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

ML API runs at: `http://localhost:8000`
Interactive docs: `http://localhost:8000/docs`

#### Example request

```json
POST /predict
{
  "request_count": 1200,
  "active_users": 480,
  "cpu_usage": 72.5,
  "memory_usage": 64.1,
  "p95_latency": 310,
  "current_replicas": 2
}
```

#### Example response

```json
{
  "status": "ok",
  "model": "xgboost",
  "prediction": "scale_up",
  "recommended_replicas": 4,
  "confidence": 0.82
}
```

### Running Everything Locally

Open **two** terminals:

**Terminal 1 — Frontend**

```bash
npm run dev
```

**Terminal 2 — ML Backend**

```bash
cd src/scaling-ml/api
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

---

## Docker

Two independent images so the frontend and ML service can be deployed separately.

| Service    | Dockerfile                        |
| ---------- | --------------------------------- |
| Frontend   | `./Dockerfile`                    |
| ML Backend | `./src/scaling-ml/api/Dockerfile` |

---

## Kubernetes on AWS EKS

All manifests live in `k8s/` and cover:

- `Deployment`
- `Service`
- `Ingress`
- `HorizontalPodAutoscaler`

### Apply

```bash
kubectl apply -f k8s/
```

### Inspect

```bash
kubectl get pods
kubectl get deployments
kubectl get services
kubectl get ingress
kubectl get hpa
```

### Tear down

```bash
kubectl delete deployment --all
kubectl delete service --all
kubectl delete hpa --all
kubectl delete ingress --all
```

---

## Load Testing

Simulate traffic with k6 to observe latency and HPA behavior under load:

```bash
k6 run load-test.js
```

This is what drives the metrics the dashboard visualizes and the ML model reacts to.

---

## AWS Cleanup

**Always tear down AWS resources after a demo** to avoid charges.

```bash
# List clusters
aws eks list-clusters --region us-east-2

# Delete the cluster
eksctl delete cluster --name ai-autoscaling-demo --region us-east-2
```

Verify nothing was left behind:

```bash
# Load balancers
aws elbv2 describe-load-balancers --region us-east-2

# EC2 instances
aws ec2 describe-instances \
  --region us-east-2 \
  --filters "Name=instance-state-name,Values=running,pending,stopping,stopped" \
  --query "Reservations[].Instances[].{ID:InstanceId,State:State.Name,Name:Tags[?Key=='Name']|[0].Value}" \
  --output table

# EBS volumes
aws ec2 describe-volumes \
  --region us-east-2 \
  --query "Volumes[].{ID:VolumeId,State:State,Size:Size,Attached:Attachments[0].InstanceId}" \
  --output table

# Elastic IPs
aws ec2 describe-addresses \
  --region us-east-2 \
  --query "Addresses[].{IP:PublicIp,Instance:InstanceId,AllocationId:AllocationId}" \
  --output table

# CloudFormation stacks
aws cloudformation list-stacks \
  --region us-east-2 \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED \
  --query "StackSummaries[*].[StackName,StackStatus]" \
  --output table
```

---

## Git Hygiene

Never commit the Python virtual environment or bytecode cache.

Add to `.gitignore`:

```gitignore
# Python
src/scaling-ml/api/venv/
src/scaling-ml/api/__pycache__/
*.pyc
```

If they were already tracked, untrack them:

```bash
git rm -r --cached src/scaling-ml/api/venv
git rm -r --cached src/scaling-ml/api/__pycache__
git add .gitignore
git commit -m "Ignore Python cache and virtual environment"
```

---

## Project Summary

This project is deliberately simple — but it covers the full surface of a real cloud system:

- **Deployment** on managed Kubernetes (EKS)
- **Networking** via Service + Ingress + load balancer
- **Autoscaling** with HPA
- **Observability** through a live dashboard
- **Load generation** with k6
- **AI assistance** via a trained model serving predictions over HTTP

The result is a compact end-to-end demonstration of how an intelligent layer can sit on top of standard cloud primitives to make scaling decisions more proactive.
