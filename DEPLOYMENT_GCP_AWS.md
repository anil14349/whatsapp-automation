# Deployment Guide: GCP / AWS (with Cron Jobs)

Deploy clinic-app on Google Cloud Platform or Amazon Web Services instead of Vercel, with proper cron job scheduling.

---

## Overview: Cron Jobs in clinic-app

The app has 3 scheduled jobs:

| Job | Schedule | Purpose | File |
|-----|----------|---------|------|
| **Reminders** | Every 30 min | Send appointment reminders | `/api/cron/reminders` |
| **Auto-Complete** | Every 1 hour | Mark past appointments complete | `/api/cron/auto-complete` |
| **Log Cleanup** | Daily (1 AM) | Clean up old message logs | `/api/cron/log-cleanup` |

All jobs use **Bearer token authentication** via `Authorization: Bearer {CRON_SECRET}` header.

---

# Part A: Google Cloud Platform (GCP)

## Step 1: Set Up GCP Project

### 1.1 Create Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Create Project**
3. Name: `abc-clinic-whatsapp`
4. Click **Create**
5. Wait for project to be created

### 1.2 Enable Required APIs

1. In search bar, search for **Cloud Run**
2. Click **Enable** for "Cloud Run API"
3. Repeat for:
   - ✅ Cloud Scheduler API
   - ✅ Cloud Build API
   - ✅ Artifact Registry API
   - ✅ Secret Manager API

### 1.3 Set Up Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Name: `clinic-whatsapp-service`
4. Click **Create and Continue**
5. Grant roles:
   - `Cloud Run Service Agent`
   - `Secret Manager Secret Accessor`
   - `Cloud Scheduler Service Agent`
6. Click **Create Key** → **JSON** (save locally)

---

## Step 2: Prepare Application for Cloud Run

### 2.1 Create Dockerfile

In `clinic-app/` root, create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start app
CMD ["npm", "start"]
```

### 2.2 Create .dockerignore

```
node_modules
.next
.git
.env.local
.DS_Store
README.md
```

### 2.3 Test Locally (Optional)

```bash
cd clinic-app

# Build image
docker build -t clinic-app:latest .

# Run container
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG... \
  clinic-app:latest

# Test: curl http://localhost:3000/api/health
```

---

## Step 3: Deploy to Cloud Run

### 3.1 Set Up GCP CLI

```bash
# Install GCP CLI: https://cloud.google.com/sdk/docs/install
gcloud init

# Set project
gcloud config set project abc-clinic-whatsapp

# Authenticate
gcloud auth login
```

### 3.2 Create app.yaml (App Engine Alternative)

If using App Engine instead of Cloud Run, create `app.yaml` in `clinic-app/`:

```yaml
runtime: nodejs20

env: standard

instance_class: F1

env_variables:
  NODE_ENV: "production"
  NEXT_PUBLIC_SUPABASE_URL: "https://xxxxx.supabase.co"
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbG..."

# Cron jobs handled separately in cron.yaml

handlers:
  - url: /.*
    secure: always
    script: auto
```

### 3.3 Deploy Using Cloud Run

**Option A: Using gcloud CLI**

```bash
cd clinic-app

# Deploy to Cloud Run
gcloud run deploy clinic-app \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600s

# Output will include service URL, e.g.:
# Service URL: https://clinic-app-xxxxx.run.app
```

**Option B: Using Cloud Console**

1. Go to **Cloud Run**
2. Click **Create Service**
3. Choose **Deploy one revision from an image**
4. Select your built image from Artifact Registry
5. Configure settings:
   - **Memory**: 512 MB
   - **CPU**: 1
   - **Timeout**: 3600s
   - **Concurrency**: 100
6. Deploy

### 3.4 Set Environment Variables

After deployment:

1. Go to **Cloud Run** → Select **clinic-app** service
2. Click **Edit & Deploy New Revision**
3. Go to **Runtime settings** → **Runtime environment variables**
4. Add all from `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx...
WHATSAPP_WEBHOOK_POST_TOKEN=my_token_123
ADMIN_SESSION_SECRET=very_long_random_secret
CRON_SECRET=another_random_secret_for_cron
CLINIC_TIMEZONE=Asia/Kolkata
CLINIC_NAME=ABC Clinic
```

5. Click **Deploy**

### 3.5 Update WhatsApp Webhook

1. Go to **Cloud Run** → **clinic-app** service
2. Copy the **Service URL** (e.g., `https://clinic-app-xxxxx.run.app`)
3. Go to Meta App Dashboard → **Configuration** → **Webhooks**
4. Update:
   - **Callback URL**: `https://clinic-app-xxxxx.run.app/api/whatsapp/webhook`
   - **Verify Token**: Same as `WHATSAPP_WEBHOOK_POST_TOKEN`
5. Verify and save

---

## Step 4: Set Up Cloud Scheduler (Cron Jobs)

### 4.1 Configure Appointment Reminders (Every 30 min)

1. Go to **Cloud Scheduler**
2. Click **Create Job**
3. Configure:
   - **Name**: `appointment-reminders`
   - **Frequency**: `*/30 * * * *` (every 30 minutes)
   - **Timezone**: Your timezone
4. Click **Continue**
5. Configure execution:
   - **HTTP Method**: GET
   - **URL**: `https://clinic-app-xxxxx.run.app/api/cron/reminders`
   - **Auth header**: Add OIDC token
   - **Service account**: Select the one created in Step 1.3

6. Click **Create**

### 4.2 Configure Auto-Complete (Every 1 hour)

1. Click **Create Job**
2. Configure:
   - **Name**: `auto-complete-appointments`
   - **Frequency**: `0 * * * *` (hourly at :00)
3. Click **Continue**
4. Configure execution:
   - **URL**: `https://clinic-app-xxxxx.run.app/api/cron/auto-complete`
   - Same auth as above
5. Click **Create**

### 4.3 Configure Log Cleanup (Daily at 1 AM)

1. Click **Create Job**
2. Configure:
   - **Name**: `log-cleanup`
   - **Frequency**: `0 1 * * *` (1 AM daily)
3. Click **Continue**
4. Configure execution:
   - **URL**: `https://clinic-app-xxxxx.run.app/api/cron/log-cleanup`
   - Same auth as above
5. Click **Create**

### 4.4 Use Authorization Header Instead of OIDC (Recommended)

For simpler authentication, use custom `Authorization` header:

1. In **Cloud Scheduler** job settings, toggle to **Authorization header**
2. Select **Add OIDC header** → **Remove** (if present)
3. Manually add header:
   - **Name**: `Authorization`
   - **Value**: `Bearer {CRON_SECRET}` (from `.env.local`)

**Better approach**: Use Cloud Secrets:

```bash
# Create secret in Secret Manager
gcloud secrets create clinic-cron-secret --data-file=- <<< "your_cron_secret_here"

# Reference in Cloud Scheduler job
# Value: Bearer $(gcloud secrets versions access latest --secret=clinic-cron-secret)
```

---

## Step 5: Test Cron Jobs

### 5.1 Manual Test

```bash
# Test reminders endpoint
curl -H "Authorization: Bearer your_cron_secret" \
  https://clinic-app-xxxxx.run.app/api/cron/reminders

# Should return JSON with result
```

### 5.2 Force Run Scheduler Job

1. Go to **Cloud Scheduler**
2. Click the job name
3. Click **Force run** button
4. Wait a few seconds
5. Check **Execution logs** for result

---

# Part B: Amazon Web Services (AWS)

## Step 1: Set Up AWS Account

### 1.1 Create IAM User

1. Go to [AWS Console](https://console.aws.amazon.com)
2. Go to **IAM** → **Users** → **Create user**
3. Name: `clinic-whatsapp`
4. Attach policies:
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AWSAppRunnerServiceRolePolicy`
   - `EventBridgeFullAccess`
   - `CloudWatchLogsFullAccess`
5. Create access keys (save locally)

### 1.2 Configure AWS CLI

```bash
# Install AWS CLI: https://aws.amazon.com/cli/
aws configure

# Enter:
# AWS Access Key ID: (from step 1.1)
# AWS Secret Access Key: (from step 1.1)
# Default region: us-east-1
# Default output format: json
```

---

## Step 2: Push Image to ECR (Elastic Container Registry)

### 2.1 Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name clinic-app \
  --region us-east-1

# Output: repositoryUri: xxxxxx.dkr.ecr.us-east-1.amazonaws.com/clinic-app
```

### 2.2 Build and Push Docker Image

```bash
cd clinic-app

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  xxxxxx.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -t clinic-app:latest .

# Tag image
docker tag clinic-app:latest \
  xxxxxx.dkr.ecr.us-east-1.amazonaws.com/clinic-app:latest

# Push to ECR
docker push xxxxxx.dkr.ecr.us-east-1.amazonaws.com/clinic-app:latest
```

---

## Step 3: Deploy on AWS App Runner

### 3.1 Create App Runner Service

1. Go to **App Runner** in AWS Console
2. Click **Create an App Runner service**
3. Configure:
   - **Source**: Amazon ECR
   - **ECR image URI**: (from Step 2.1)
   - **Deployment trigger**: Manual
4. Click **Next**
5. Configure service:
   - **Service name**: `clinic-app`
   - **Port**: `3000`
   - **CPU**: `1 vCPU`
   - **Memory**: `2 GB`
6. Click **Next**

### 3.2 Add Environment Variables

1. In **Configure environment**, add all variables:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx...
WHATSAPP_WEBHOOK_POST_TOKEN=my_token_123
ADMIN_SESSION_SECRET=very_long_random_secret
CRON_SECRET=another_random_secret_for_cron
CLINIC_TIMEZONE=Asia/Kolkata
CLINIC_NAME=ABC Clinic
```

2. Click **Create & Deploy**
3. Wait for service to be ready (~5 min)
4. Copy **Service URL**

### 3.3 Update WhatsApp Webhook

1. Go to Meta App Dashboard → **Webhooks**
2. Update callback URL to: `https://{APP_RUNNER_URL}/api/whatsapp/webhook`
3. Verify and save

---

## Step 4: Set Up EventBridge (Cron Scheduler)

### 4.1 Create Appointment Reminders Rule

```bash
aws events put-rule \
  --name appointment-reminders \
  --schedule-expression "rate(30 minutes)" \
  --state ENABLED

aws events put-targets \
  --rule appointment-reminders \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:ACCOUNT:function:clinic-cron","RoleArn"="arn:aws:iam::ACCOUNT:role/service-role/EventBridgeRole"
```

### 4.2 Create Auto-Complete Rule

```bash
aws events put-rule \
  --name auto-complete-appointments \
  --schedule-expression "rate(1 hour)" \
  --state ENABLED

aws events put-targets \
  --rule auto-complete-appointments \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:ACCOUNT:function:clinic-cron"
```

### 4.3 Create Log Cleanup Rule

```bash
aws events put-rule \
  --name log-cleanup \
  --schedule-expression "cron(0 1 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule log-cleanup \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:ACCOUNT:function:clinic-cron"
```

### 4.4 Alternative: Use Lambda for Cron

**Option A: Lambda-based scheduler (simpler)**

1. Create Lambda function
2. Create new file: `lambda/index.js`:

```javascript
const https = require('https');

exports.handler = async (event) => {
  const endpoint = process.env.APP_URL + event.path;
  const secret = process.env.CRON_SECRET;
  
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Authorization': `Bearer ${secret}`
      }
    };
    
    https.get(endpoint, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    }).on('error', reject);
  });
};
```

3. Upload to Lambda
4. Set environment variables:
   - `APP_URL`: Your App Runner URL
   - `CRON_SECRET`: Your cron secret
5. Create EventBridge rules to trigger Lambda

---

## Step 5: Set Up CloudWatch Logs & Monitoring

### 5.1 View App Logs

```bash
# Stream logs in real-time
aws logs tail /aws/apprunner/clinic-app/default_service --follow

# View logs for specific time
aws logs filter-log-events \
  --log-group-name /aws/apprunner/clinic-app/default_service \
  --start-time $(date -d '1 hour ago' +%s)000
```

### 5.2 Create Alarms

```bash
# Alert on errors
aws cloudwatch put-metric-alarm \
  --alarm-name clinic-app-errors \
  --alarm-description "Alert on app errors" \
  --metric-name ErrorCount \
  --namespace AWS/AppRunner \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:clinic-alerts
```

---

## Step 6: Alternative: Deploy on AWS ECS (Elastic Container Service)

### 6.1 Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name clinic-cluster
```

### 6.2 Register Task Definition

Create `ecs-task-definition.json`:

```json
{
  "family": "clinic-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "clinic-app",
      "image": "xxxxxx.dkr.ecr.us-east-1.amazonaws.com/clinic-app:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NEXT_PUBLIC_SUPABASE_URL",
          "value": "https://xxxxx.supabase.co"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/clinic-app",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Register:
```bash
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json
```

### 6.3 Run Service

```bash
aws ecs create-service \
  --cluster clinic-cluster \
  --service-name clinic-app \
  --task-definition clinic-app \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx],securityGroups=[sg-xxxxx],assignPublicIp=ENABLED}"
```

---

## Step 7: Cost Comparison

### GCP Cloud Run
- **Requests**: $0.40 per million
- **vCPU-seconds**: $0.00002400
- **Memory-seconds**: $0.0000050
- **Networking**: $0.10-0.20/GB
- **Estimated monthly**: $5-15

### AWS App Runner
- **Processing**: $0.064 per vCPU-hour
- **Memory**: $0.007 per GB-hour
- **Networking**: $0.02/GB outbound
- **Estimated monthly**: $30-50

### AWS Lambda (for cron only)
- **Invocations**: $0.20 per million
- **Duration**: $0.0000166667 per GB-second
- **Estimated monthly for cron**: <$1

---

## Cron Jobs Summary

| Job | Cron Expression | Platform |
|-----|-----------------|----------|
| Appointment Reminders | `*/30 * * * *` | GCP: Cloud Scheduler / AWS: EventBridge |
| Auto-Complete | `0 * * * *` | Same |
| Log Cleanup | `0 1 * * *` | Same |

**Authentication**: All use `Authorization: Bearer {CRON_SECRET}` header

---

## Quick Troubleshooting

### Cron Not Running?
1. Check Cloud Scheduler / EventBridge job status
2. Check service logs for authorization errors
3. Verify `CRON_SECRET` matches
4. Try manual invocation first

### App Not Starting?
1. Check container logs
2. Verify all env variables are set
3. Check Supabase connection
4. Test health endpoint: `/api/health`

### Cron Returns 401?
1. Verify `CRON_SECRET` environment variable is set
2. Check authorization header format: `Bearer {SECRET}`
3. Ensure secrets match between Cloud Scheduler config and app env

---

## Production Checklist

- [ ] App deployed and responding to requests
- [ ] WhatsApp webhook configured and verified
- [ ] All env variables set correctly
- [ ] Database backups enabled
- [ ] Cron jobs configured
- [ ] Manual cron job test successful
- [ ] Monitoring/alerts set up
- [ ] Admin user created
- [ ] Health check passing (`/api/health`)
- [ ] Test booking flow end-to-end

---

## Cleanup / Tear Down

### GCP

```bash
# Delete Cloud Run service
gcloud run services delete clinic-app --region us-central1

# Delete Cloud Scheduler jobs
gcloud scheduler jobs delete appointment-reminders
gcloud scheduler jobs delete auto-complete-appointments
gcloud scheduler jobs delete log-cleanup

# Delete project
gcloud projects delete abc-clinic-whatsapp
```

### AWS

```bash
# Stop App Runner service
aws apprunner stop-service --service-arn arn:aws:apprunner:...

# Delete App Runner service
aws apprunner delete-service --service-arn arn:aws:apprunner:...

# Delete ECR repository
aws ecr delete-repository --repository-name clinic-app

# Delete EventBridge rules
aws events delete-rule --name appointment-reminders
```

