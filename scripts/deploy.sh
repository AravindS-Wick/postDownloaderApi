#!/bin/bash

# Deployment script for Social Downloader API
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="social-downloader"
APP_NAME="social-downloader-api"
IMAGE_TAG=${1:-latest}

echo -e "${GREEN}🚀 Starting deployment of ${APP_NAME}...${NC}"

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ kubectl is not installed or not in PATH${NC}"
    exit 1
fi

# Check if we're connected to a cluster
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}❌ Not connected to a Kubernetes cluster${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Current cluster info:${NC}"
kubectl cluster-info

# Create namespace if it doesn't exist
echo -e "${GREEN}📁 Creating namespace...${NC}"
kubectl apply -f k8s/namespace.yaml

# Apply ConfigMap and Secrets
echo -e "${GREEN}⚙️  Applying configuration...${NC}"
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml

# Apply deployment
echo -e "${GREEN}🏗️  Deploying application...${NC}"
kubectl apply -f k8s/deployment.yaml

# Apply service
echo -e "${GREEN}🌐 Creating service...${NC}"
kubectl apply -f k8s/service.yaml

# Apply ingress (optional)
if [ -f "k8s/ingress.yaml" ]; then
    echo -e "${GREEN}🔗 Creating ingress...${NC}"
    kubectl apply -f k8s/ingress.yaml
fi

# Apply service monitor (optional)
if [ -f "k8s/servicemonitor.yaml" ]; then
    echo -e "${GREEN}📊 Creating service monitor...${NC}"
    kubectl apply -f k8s/servicemonitor.yaml
fi

# Wait for deployment to be ready
echo -e "${GREEN}⏳ Waiting for deployment to be ready...${NC}"
kubectl rollout status deployment/${APP_NAME} -n ${NAMESPACE} --timeout=300s

# Get deployment status
echo -e "${GREEN}📊 Deployment status:${NC}"
kubectl get pods -n ${NAMESPACE} -l app=${APP_NAME}

# Get service info
echo -e "${GREEN}🌐 Service info:${NC}"
kubectl get svc -n ${NAMESPACE}

# Get ingress info (if exists)
if kubectl get ingress -n ${NAMESPACE} &> /dev/null; then
    echo -e "${GREEN}🔗 Ingress info:${NC}"
    kubectl get ingress -n ${NAMESPACE}
fi

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"

# Show logs
echo -e "${YELLOW}📝 Recent logs:${NC}"
kubectl logs -n ${NAMESPACE} -l app=${APP_NAME} --tail=20
