import * as jose from 'jsr:@panva/jose@6'

console.log('main function started')

const MAX_WORKER_RETRIES = 3

const JWT_SECRET = Deno.env.get('JWT_SECRET')
const SUPABASE_JWKS = parseJwks(Deno.env.get('SUPABASE_JWKS'))
const LOCAL_JWKS = SUPABASE_JWKS ? jose.createLocalJWKSet(SUPABASE_JWKS) : null
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'

type AuthFailure = {
  code: RequestErrors
  message?: string
}

type FunctionFailure = {
  code: RequestErrors
  message: string
  status: number
}

export enum RequestErrors {
  InvalidLegacyJWT = 'UNAUTHORIZED_LEGACY_JWT',
  InvalidAsymmetricJWT = 'UNAUTHORIZED_ASYMMETRIC_JWT',
  InvalidTokenFormat = 'UNAUTHORIZED_INVALID_JWT_FORMAT',
  UnsupportedTokenAlgorithm = 'UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM',
  MissingAuthHeader = 'UNAUTHORIZED_NO_AUTH_HEADER',
  NotFound = 'NOT_FOUND',
  BootError = 'BOOT_ERROR',
  EdgeFunctionError = 'EDGE_FUNCTION_ERROR',
  IdleTimeout = 'IDLE_TIMEOUT',
  WorkerResourceLimit = 'WORKER_RESOURCE_LIMIT',
  WorkerError = 'WORKER_ERROR',
  InvalidResponseStatusCode = 'INVALID_RESPONSE_STATUS_CODE',
}

function getFunctionErrorResponse({ code, message, status }: FunctionFailure): Response {
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        'sb-error-code': code,
        'Access-Control-Expose-Headers': 'sb-error-code',
      },
    }
  )
}

function handleWorkerResponse(response: Response): Response {
  if (response.status < 500) return response

  const headers = new Headers(response.headers)
  headers.set('sb-error-code', RequestErrors.EdgeFunctionError)

  const exposedHeaders = (headers.get('Access-Control-Expose-Headers') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!exposedHeaders.some((name) => name.toLowerCase() === 'sb-error-code')) {
    exposedHeaders.push('sb-error-code')
  }
  headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '))

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function resolveRuntimeError(e: unknown): FunctionFailure {
  // These error classes are supplied by Edge Runtime, rather than stock Deno.
  if (e instanceof Deno.errors.InvalidWorkerCreation) {
    return {
      code: RequestErrors.BootError,
      message: 'Function failed to start (please check logs)',
      status: 503,
    }
  }
  if (e instanceof Deno.errors.WorkerRequestCancelled) {
    return {
      code: RequestErrors.WorkerResourceLimit,
      message: 'Function failed due to not having enough compute resources (please check logs)',
      status: 546,
    }
  }
  if (e instanceof Deno.errors.WorkerRequestIdleTimeout) {
    return {
      code: RequestErrors.IdleTimeout,
      message: 'Request idle timeout limit (150s) reached',
      status: 504,
    }
  }
  // No dedicated runtime error class exists for invalid response statuses.
  // The Response constructor throws directly here or inside the user worker.
  if (
    (e instanceof RangeError || e instanceof Deno.errors.InvalidWorkerResponse) &&
    e.message.includes('is not equal to 101 and outside the range [200, 599]')
  ) {
    return {
      code: RequestErrors.InvalidResponseStatusCode,
      message: 'Function returned an invalid HTTP status code (please check logs)',
      status: 500,
    }
  }
  if (
    e instanceof Deno.errors.WorkerAlreadyRetired ||
    e instanceof Deno.errors.InvalidWorkerResponse
  ) {
    return {
      code: RequestErrors.WorkerError,
      message: 'Function exited due to an error (please check logs)',
      status: 500,
    }
  }
  return { code: RequestErrors.EdgeFunctionError, message: 'Internal Server Error', status: 500 }
}

// NOTE:(kallebysantos) We don't check for valid keys but just the bare array parsing,
// let this for 'jose' lib verification
export function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.keys && Array.isArray(parsed.keys)) {
      return parsed as jose.JSONWebKeySet
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract JWT token from 'Authorization' header or fallback to 'sb-api-key' compatibility
 *
 * Parses the Authorization header to extract the Bearer token.
 * Expects format: "Bearer <token>"
 *
 * @param req - The HTTP request object
 * @returns The JWT token string or an authentication failure
 */
function extractBearerToken(authHeader: string | null): string | null {
  const tokenParts = (authHeader ?? '').trim().split(/\s+/)
  const [bearer, token] = tokenParts
  if (bearer.toLowerCase() !== 'bearer' || tokenParts.length !== 2 || !token) {
    return null
  }
  return token
}

function getAuthToken(req: Request): string | AuthFailure {
  const authHeader = req.headers.get('authorization')
  const sbApiKeyCompatibilityToken = req.headers.get('sb-api-key')

  if (!authHeader && !sbApiKeyCompatibilityToken) {
    return {
      code: RequestErrors.MissingAuthHeader,
      message: 'Missing authorization header',
    }
  }

  // NOTE:(kallebysantos) Compatibility mode is triggered when all conditions match:
  // - API proxy mints a temp token
  // - Original bearer is not present or is ApiKey
  const bearerToken = extractBearerToken(authHeader)
  const token = !bearerToken || bearerToken.startsWith('sb_')
    ? sbApiKeyCompatibilityToken
    : bearerToken

  if (!token) {
    return {
      code: RequestErrors.InvalidTokenFormat,
      message: 'Invalid JWT format',
    }
  }

  return token
}

function getAuthErrorResponse({ code, message = 'Invalid JWT' }: AuthFailure) {
  return Response.json(
    {
      code,
      message,
      // DEPRECATED: Retained for backward compatibility.
      msg: message,
    },
    {
      status: 401,
      headers: {
        'sb-error-code': code,
        'Access-Control-Expose-Headers': 'sb-error-code',
      },
    }
  )
}

async function isValidLegacyJWT(jwt: string): Promise<AuthFailure | null> {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not available for HS256 token verification')
    return { code: RequestErrors.InvalidLegacyJWT }
  }

  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET);

  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error('Symmetric Legacy JWT verification error', e);
    return { code: RequestErrors.InvalidLegacyJWT }
  }
  return null
}

async function isValidJWT(jwt: string): Promise<AuthFailure | null> {
  if (!LOCAL_JWKS) {
    console.error('JWKS not available for ES256/RS256 token verification')
    return { code: RequestErrors.InvalidAsymmetricJWT }
  }

  try {
    await jose.jwtVerify(jwt, LOCAL_JWKS);
  } catch (e) {
    console.error('Asymmetric JWT verification error', e);
    return { code: RequestErrors.InvalidAsymmetricJWT }
  }

  return null
}

/**
 * Verify JWT token, handling both legacy (HS256) and newer (ES256/RS256) algorithms
 * 
 * This function automatically detects the algorithm used in the token and applies
 * the appropriate verification method:
 * - HS256: Uses JWT_SECRET (symmetric key)
 * - ES256/RS256: Uses JWKS endpoint (asymmetric public keys)
 * 
 * This fix ensures compatibility with both legacy tokens and newer asymmetric tokens,
 * resolving the "Key for the ES256 algorithm must be of type CryptoKey" error.
 * 
 * @param jwt - The JWT token string to verify
 * @returns Authentication failure details, or null when verification succeeds
 */
async function isValidHybridJWT(jwt: string): Promise<AuthFailure | null> {
  let jwtAlgorithm: string | undefined
  try {
    jwtAlgorithm = jose.decodeProtectedHeader(jwt).alg
  } catch (e) {
    console.error('JWT format error', e)
    return {
      code: RequestErrors.InvalidTokenFormat,
      message: 'Invalid JWT format',
    }
  }

  if (!jwtAlgorithm) {
    return {
      code: RequestErrors.InvalidTokenFormat,
      message: 'Invalid JWT format',
    }
  }

  if (jwtAlgorithm === 'HS256') {
    console.log(`Legacy token type detected, attempting ${jwtAlgorithm} verification.`)

    return await isValidLegacyJWT(jwt)
  }

  if (jwtAlgorithm === 'ES256' || jwtAlgorithm === 'RS256') {
    return await isValidJWT(jwt)
  }

  return {
    code: RequestErrors.UnsupportedTokenAlgorithm,
    message: `Unsupported JWT algorithm ${jwtAlgorithm}`,
  }
}

const HVAC_FUNCTIONS = {"auth_send_email": {"verify_jwt": false, "version": 1}, "admin-ensure-user": {"verify_jwt": true, "version": 9}, "staff-terminate": {"verify_jwt": true, "version": 9}, "admin-delete-photo": {"verify_jwt": true, "version": 12}, "admin-delete-invoice": {"verify_jwt": true, "version": 12}, "admin-delete-invoice-bundle": {"verify_jwt": true, "version": 10}, "push-on-message": {"verify_jwt": true, "version": 9}, "task_morning": {"verify_jwt": true, "version": 8}, "task_nudge": {"verify_jwt": true, "version": 8}, "gmail_list": {"verify_jwt": true, "version": 20}, "gmail_get": {"verify_jwt": true, "version": 12}, "gmail_send": {"verify_jwt": true, "version": 21}, "gmail_modify": {"verify_jwt": true, "version": 7}, "oauth_google_start": {"verify_jwt": false, "version": 13}, "oauth_google_callback": {"verify_jwt": false, "version": 17}, "send-invoice-email": {"verify_jwt": true, "version": 14}, "on-location-upsert": {"verify_jwt": true, "version": 5}, "on-new-message": {"verify_jwt": true, "version": 5}, "calendar-badge": {"verify_jwt": true, "version": 4}, "gmail_attachment": {"verify_jwt": true, "version": 8}};
// Self-hosted production routing: retained unknown caller contracts remain restricted.
// Unknown business-caller contracts are service-only, never opened to public anon JWTs.
function localCors(req: Request) {
 const origin=req.headers.get('origin');
 return origin===(Deno.env.get('HVAC_OAUTH_APP_ORIGIN')||'https://hvac-app-jade.vercel.app') ? {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'} : {};
}
Deno.serve(async (req: Request) => {
  const slug=new URL(req.url).pathname.split('/')[1];
  const config=HVAC_FUNCTIONS[slug];
  if (!config) return Response.json({error:'FUNCTION_NOT_REGISTERED'},{status:404});
  const bootProbe=req.headers.get('x-local-boot-probe')==='1';
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:localCors(req)});

  if ((config.verify_jwt && VERIFY_JWT) || bootProbe) {
    try {
      const token = getAuthToken(req)
      if (typeof token !== 'string') {
        return getAuthErrorResponse(token)
      }
      const authFailure = await isValidHybridJWT(token)
      if (authFailure) {
        return getAuthErrorResponse(authFailure)
      }
    } catch (e) {
      console.error(e)
      return getAuthErrorResponse({
        code: RequestErrors.InvalidTokenFormat,
        message: 'Invalid JWT format',
      })
    }
  }

  const url = new URL(req.url)
  const { pathname } = url
  const path_parts = pathname.split('/')
  const service_name = path_parts[1]

  if (!service_name || service_name === '') {
    return getFunctionErrorResponse({
      code: RequestErrors.NotFound,
      message: 'Requested function was not found',
      status: 404,
    })
  }

  const callerToken=getAuthToken(req);
  const serviceCaller=typeof callerToken==='string' && callerToken===Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (bootProbe && !serviceCaller) return Response.json({error:'LOCAL_PROBE_SERVICE_ONLY'},{status:403});
  if (!bootProbe) {
    // Shared Gmail is live-staff and organization scoped; deferred legacy wrappers remain disabled.
    if (service_name==='send-invoice-email') {
      return Response.json({error:'LOCAL_SEND_DISABLED_OWNER_TEST_RECIPIENT_REQUIRED'},{status:503,headers:localCors(req)});
    }
    if (service_name==='gmail_modify') {
      return Response.json({error:'LOCAL_OAUTH_OR_LEGACY_CONTRACT_UNCONFIRMED'},{status:503,headers:localCors(req)});
    }
    if (!serviceCaller && !service_name.startsWith('oauth_google_') && service_name!=='auth_send_email') {
      const confirmedRoles: Record<string,string[]> = {'admin-ensure-user':['admin'],'staff-terminate':['admin'],'admin-delete-photo':['admin','manager'],'admin-delete-invoice':['admin','manager'],'gmail_list':['admin','manager'],'gmail_get':['admin','manager'],'gmail_attachment':['admin','manager'],'gmail_send':['admin','manager']};
      const required=confirmedRoles[service_name];
      let authorized=false;
      if (required && typeof callerToken==='string') {
        const base=Deno.env.get('SUPABASE_URL');
        const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const userResponse=await fetch(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${callerToken}`}});
        if (userResponse.ok) {
          const user=await userResponse.json();
          const profileResponse=await fetch(`${base}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(user.id)}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
          if (profileResponse.ok) {
            const profiles=await profileResponse.json();
            authorized=profiles.length===1 && required.includes(profiles[0].role);
            if (authorized && service_name.startsWith('gmail_')) {
              const contextResponse=await fetch(`${base}/rest/v1/rpc/hvac_oauth_context`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${callerToken}`,'Content-Type':'application/json'},body:'{}'});
              const configResponse=await fetch(`${base}/rest/v1/rpc/hvac_oauth_store`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({action:'config',args:{mailbox:'hvac-gmail'}})});
              const ctx=contextResponse.ok?await contextResponse.json():null;
              const cfg=configResponse.ok?await configResponse.json():null;
              authorized=!!ctx && !!cfg && ctx.user===user.id && ctx.org===cfg.org;
            }

          }
        }
      }
      if (!authorized) return Response.json({error:'TRUSTED_CALLER_REQUIRED',reason:'Unverified caller contract is quarantined in local validation'},{status:403,headers:localCors(req)});
    }
  }
  const servicePath = `/home/deno/functions/${service_name}`
  console.error(`serving the request with ${servicePath}`)

  try {
    const serviceInfo = await Deno.stat(servicePath)
    if (!serviceInfo.isDirectory) {
      return getFunctionErrorResponse({
        code: RequestErrors.NotFound,
        message: 'Requested function was not found',
        status: 404,
      })
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return getFunctionErrorResponse({
        code: RequestErrors.NotFound,
        message: 'Requested function was not found',
        status: 404,
      })
    }
    console.error(e)
    return getFunctionErrorResponse({
      code: RequestErrors.BootError,
      message: 'Function failed to start (please check logs)',
      status: 503,
    })
  }

  const memoryLimitMb = 150
  // Keep the wall clock above the 150s request idle timeout configured in Compose.
  const workerTimeoutMs = 400_000
  const requestAbsentTimeoutMs = 60_000
  const noModuleCache = false
  // Using a common Import Map for all functions 
  // to use a scope 'deno.json' it must be dinamically resolved base on the 'service_name'
  const importMapPath = `/home/deno/functions/deno.jsonc`
  // SUPABASE_FUNCTION_SLUG is listed after the container env snapshot so
  // nothing in it can shadow the value, and it is per-request because only this
  // worker knows which function the request resolved to.
  const envVarsObj = { ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: service_name }
  const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])

  const callWorker = async (req: Request, retriesLeft = MAX_WORKER_RETRIES): Promise<Response> => {
    // Preserve the body before fetch() can consume it, even on a failed attempt.
    // Must run before `new Request(req)` below, which takes over the body.
    // The unread retry branch can buffer the entire body in main-worker memory,
    // even when the first attempt succeeds.
    const retryReq = retriesLeft > 0 ? req.clone() : null

    try {
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath,
        maybeEszip: await Deno.readFile(`${servicePath}/bundle.eszip`),
        maybeEntrypoint: `file://${servicePath}/index.ts`,
        memoryLimitMb,
        workerTimeoutMs,
        context: { supervisor: { requestAbsentTimeoutMs } },
        noModuleCache,
        importMapPath,
        envVars,
      })
      if (bootProbe) return Response.json({status:'WORKER_CREATED_NOT_INVOKED',function:service_name},{headers:localCors(req)});
      // Gateway-minted internal JWT is for this router only; never expose it to user functions.
      const userReq = new Request(req)
      userReq.headers.delete('sb-api-key')
      EdgeRuntime.applySupabaseTag(req, userReq)
      return handleWorkerResponse(await worker.fetch(userReq))
    } catch (e) {
      // Retirement rejects before dispatch, so user code has not run yet.
      if (e instanceof Deno.errors.WorkerAlreadyRetired && retryReq) {
        console.warn(`${service_name}: worker retired before dispatch; retrying (${retriesLeft} left)`)
        // Request.clone() does not copy the tag that connects streaming to the client.
        EdgeRuntime.applySupabaseTag(req, retryReq)
        return await callWorker(retryReq, retriesLeft - 1)
      }

      console.error(e)
      return getFunctionErrorResponse(resolveRuntimeError(e))
    }
  }

  return await callWorker(req)
})
