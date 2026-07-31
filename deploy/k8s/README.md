# HoursX on Kubernetes

These manifests are a working baseline, not an opinionated platform install.
They assume PostgreSQL and Redis already exist (managed services or in-cluster
operators) and are reachable at the URLs in the Secret.

## Apply

```bash
kubectl create namespace hoursx

# Fill in real values first — the checked-in Secret contains placeholders only.
kubectl -n hoursx apply -f secret.yaml
kubectl -n hoursx apply -f configmap.yaml
kubectl -n hoursx apply -f api-deployment.yaml
kubectl -n hoursx apply -f worker-deployment.yaml
kubectl -n hoursx apply -f console-deployment.yaml
kubectl -n hoursx apply -f ingress.yaml
```

## Notes

- **Images**: replace `ghcr.io/OWNER/hoursx-*` with your registry path. Both
  server images are the same build; the container command selects API vs worker.
- **Probes**: the API serves `/healthz` (liveness) and `/readyz` (readiness —
  round-trips the database).
- **Agent sandboxes** live on an emptyDir by default, so a pod restart discards
  in-progress workspace files. Runs, messages, memory, and knowledge are all in
  PostgreSQL and survive. Mount a `ReadWriteMany` PVC at `/app/workspaces` if you
  need file artifacts to outlive the pod.
- **Scaling**: the API is stateless — scale it freely. Event fanout crosses
  replicas through Redis pub/sub, so a client connected to any replica receives
  every event for its workspace. The worker scales horizontally too; each arq
  job is claimed by exactly one worker.
- **Secrets**: `secret.yaml` holds placeholders. In production, source these from
  your secret manager (External Secrets, Vault Agent, sealed-secrets) rather than
  committing values.
