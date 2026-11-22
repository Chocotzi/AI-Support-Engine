# CI/CD: liberación y despliegue continuo

Herramientas: **GitHub Actions** orquesta, **Docker** define el entorno de liberación y **Render** (plan gratis) aloja staging y producción.

```
PR contra main  ─►  1 · Pruebas (npm test)  ─►  2 · Imagen Docker + pruebas de humo contra el contenedor
push a main     ─►  1 ─► 2 ─► 3 · Staging: deploy hook con el commit exacto ─► espera /health ─► pruebas de humo
                               ─► 4 · Producción: APROBACIÓN MANUAL ─► deploy hook ─► espera ─► pruebas de humo
cada hora       ─►  Monitor: disponibilidad, arranque en frío, latencia y errores de producción
```

Render **no** despliega solo (`autoDeployTrigger: "off"` en `render.yaml`). Solo llega a staging un commit que pasó las pruebas, y solo llega a producción el mismo commit, después de pasar staging y de que alguien lo apruebe.

## Archivos

| Entregable | Archivo | Qué hace |
|---|---|---|
| Scripts del pipeline | [`.github/workflows/pipeline.yml`](../.github/workflows/pipeline.yml) | Los 4 jobs de arriba. Con *Run workflow* y `ref` despliega un commit anterior (reversión). |
| | [`.github/workflows/monitor.yml`](../.github/workflows/monitor.yml) | Corre `scripts/monitor.mjs` contra producción cada hora. |
| Generación del entorno de liberación | [`Dockerfile`](../Dockerfile), [`.dockerignore`](../.dockerignore) | Imagen `node:24.14.0-alpine`, sin root, solo `package.json`, `src/` y `ml/model.json`. |
| | [`render.yaml`](../render.yaml) | Blueprint: crea los servicios `ai-support-engine-staging` y `ai-support-engine-production`. |
| | [`scripts/release-env.ps1`](../scripts/release-env.ps1) | Levanta la misma imagen en tu PC y le corre las pruebas de humo. |
| Pruebas en el entorno de liberación | [`scripts/smoke-test.mjs`](../scripts/smoke-test.mjs) | Salud, versión, contrato, SECURITY → revisión humana, inyección, errores 400/404/415, `/metrics` y latencia p95. |
| Generación del despliegue | [`scripts/deploy.mjs`](../scripts/deploy.mjs) | Llama al deploy hook con `ref=<commit>` y espera a que `/health` reporte esa versión. |
| Métricas | [`src/metrics.js`](../src/metrics.js), [`scripts/monitor.mjs`](../scripts/monitor.mjs) | `GET /metrics` (desde el arranque) y el monitor sintético por hora. |

## Configuración inicial (una sola vez)

### 1. Render: crear los entornos con el Blueprint

1. Entra a <https://dashboard.render.com> → **New** → **Blueprint**.
2. Conecta GitHub y elige `Chocotzi/AI-Support-Engine`, rama `main`. El `render.yaml` ya tiene que estar en `main`.
3. Render muestra los dos servicios del `render.yaml`. Dale **Apply** y espera a que ambos digan **Live**. La primera construcción la hace Render al crearlos.
4. En **cada** servicio copia dos datos:
   - la **URL** pública (arriba, `https://...onrender.com`). Si el nombre estaba ocupado, Render le agrega un sufijo.
   - **Settings → Deploy Hook**, una URL secreta con `?key=...`. Trátala como contraseña.

### 2. GitHub: environments, secretos y variables

En el repo, **Settings**:

1. **Environments → New environment** `staging` → **Add environment secret**: `RENDER_DEPLOY_HOOK` = el hook de staging.
2. **Environments → New environment** `production`:
   - marca **Required reviewers** y agrégate (`Chocotzi`). Deja **sin** marcar *Prevent self-review* para poder aprobar tus propios despliegues.
   - en **Deployment branches and tags**, elige *Selected branches* y agrega `main`.
   - **Save protection rules** y después **Add environment secret**: `RENDER_DEPLOY_HOOK` = el hook de producción.
3. **Secrets and variables → Actions → Variables → New repository variable**:
   - `STAGING_URL` = URL de staging, sin `/` al final.
   - `PRODUCTION_URL` = URL de producción, sin `/` al final.

### 3. Primera corrida

**Actions → Pipeline → Run workflow** (rama `main`, `ref` vacío). Cuando el job 4 diga *Waiting*, entra a la corrida → **Review deployments** → marca `production` → **Approve and deploy**.

## Uso diario

- **Pull request contra `main`**: corren los jobs 1 y 2. Si alguno falla, no se fusiona.
- **Fusionar a `main`**: el commit llega solo a staging. El job 4 queda esperando tu aprobación y, al aprobar, despliega a producción.
- **Revertir**: hay dos caminos.
  - **Actions → Pipeline → Run workflow** con `ref` = SHA del commit bueno. Pasa por pruebas, staging y aprobación, igual que un despliegue normal.
  - **Rollback** en el dashboard de Render. En el plan gratis solo llega a los 2 despliegues anteriores.
- **Probar el entorno en tu PC** (PowerShell, con Docker Desktop abierto):

  ```powershell
  .\scripts\release-env.ps1          # construye, levanta en :3000 y corre las pruebas de humo
  .\scripts\release-env.ps1 -Stop    # lo detiene
  npm run smoke -- https://ai-support-engine-staging.onrender.com   # pruebas de humo contra un entorno
  npm run monitor -- https://ai-support-engine-production.onrender.com
  ```

## Niveles de servicio

| Indicador (SLI) | Objetivo (SLO) | Cómo se mide |
|---|---|---|
| Disponibilidad de producción | ≥ 99 % de las revisiones horarias en verde, por mes | `monitor.yml`: historial de corridas |
| Primera respuesta (arranque en frío) | ≤ 90 s | `monitor.mjs`: "Primera respuesta" |
| Latencia de `/api/analyze` (traditional/ml, en caliente) | p95 ≤ 1000 ms, medido desde GitHub con la red incluida | `smoke-test.mjs` y `monitor.mjs` |
| Errores 5xx del motor traditional | < 1 % | `GET /metrics` → `engines.traditional.errors5xx` |
| Duración de un despliegue (hook → sirviendo) | ≤ 15 min | `deploy.mjs` (resumen del job) |
| Recuperación ante un despliegue malo | ≤ 30 min | Run workflow con `ref` anterior |

Límites del plan gratis que explican estos números: el servicio se apaga tras 15 min sin tráfico y tarda alrededor de 1 min en despertar, la cuenta tiene 750 h de instancia gratis al mes, hay una sola instancia y no hay disco persistente. El motor `generative` no tiene llave en Render, así que responde `503 PROVIDER_NOT_CONFIGURED` a propósito y no cuenta para el SLO.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `Falta RENDER_DEPLOY_HOOK` / `Falta APP_URL` | No se configuró el secreto del environment o la variable del repo (paso 2). |
| Deploy hook `HTTP 404` | Hook regenerado o mal copiado, o el commit no está en GitHub. |
| Deploy hook `HTTP 409` | Servicio suspendido o se acabaron las 750 h del mes. |
| `no sirvió <sha> en 900 s` | La construcción en Render falló: revisa *Events* y *Logs* del servicio. |
| El monitor dejó de correr | GitHub desactiva los workflows programados tras 60 días sin actividad en el repo. Reactívalo en *Actions*. |
