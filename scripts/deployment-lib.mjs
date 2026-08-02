const OFFICIAL_REPOSITORIES = new Set([
  "UniMailbox/uni-mailbox",
  "UniMailbox/unimailbox-deploy",
]);

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function bindingMap(entries = []) {
  return new Map(entries.map((entry) => [entry.binding, entry]));
}

function mergeBoundResources(current = [], upstream = []) {
  const currentByBinding = bindingMap(current);
  const upstreamBindings = new Set(upstream.map((entry) => entry.binding));
  return [
    ...upstream.map((entry) => ({
      ...entry,
      ...(currentByBinding.get(entry.binding) ?? {}),
      binding: entry.binding,
    })),
    ...current
      .filter((entry) => !upstreamBindings.has(entry.binding))
      .map((entry) => structuredClone(entry)),
  ];
}

function validateUpstream(upstream) {
  if (upstream?.schemaVersion !== 1 || upstream?.channel !== "stable") {
    throw new Error("A stable schemaVersion 1 upstream manifest is required");
  }
  for (const field of [
    "sourceRepository",
    "distributionRepository",
    "version",
    "tag",
    "sourceCommit",
  ]) {
    requiredString(upstream[field], `upstream.${field}`);
  }
  if (upstream.tag !== `v${upstream.version}`) {
    throw new Error("upstream tag must match its SemVer version");
  }
  if (!/^[0-9a-f]{40}$/u.test(upstream.sourceCommit)) {
    throw new Error("upstream.sourceCommit must be a full Git commit SHA");
  }
  return structuredClone(upstream);
}

function requireProductionBindings(wrangler) {
  const workerName = requiredString(wrangler?.name, "Worker name");
  const d1 = wrangler?.d1_databases?.find((entry) => entry.binding === "DB");
  if (!d1) throw new Error("D1 binding DB is required");
  const databaseName = requiredString(d1.database_name, "D1 database_name");
  const databaseId = requiredString(d1.database_id, "D1 database_id");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(databaseId)) {
    throw new Error("D1 database_id must be a Cloudflare-provisioned UUID");
  }
  const kvEntries = wrangler?.kv_namespaces ?? [];
  if (kvEntries.length === 0)
    throw new Error("At least one KV binding is required");
  for (const entry of kvEntries) {
    requiredString(entry.binding, "KV binding");
    const id = requiredString(entry.id, `KV ${entry.binding} id`);
    if (!/^[0-9a-f]{32}$/iu.test(id)) {
      throw new Error(`KV ${entry.binding} id must be Cloudflare-provisioned`);
    }
  }
  const producers = wrangler?.queues?.producers ?? [];
  const consumers = wrangler?.queues?.consumers ?? [];
  if (producers.length === 0 || consumers.length === 0) {
    throw new Error("Queue producer and consumer configuration is required");
  }
  return {
    workerName,
    d1,
    databaseName,
    databaseId,
    kvEntries,
    producers,
    consumers,
  };
}

export function createInstallationManifest({
  wrangler,
  r2Wrangler,
  upstream,
  repository,
  deploymentUrl,
  adoptedAt = new Date().toISOString(),
}) {
  const resources = requireProductionBindings(wrangler);
  const url = new URL(requiredString(deploymentUrl, "deployment URL"));
  if (url.protocol !== "https:") {
    throw new Error("deployment URL must use HTTPS");
  }
  const r2 = (r2Wrangler?.r2_buckets ?? []).map((entry) => ({
    binding: requiredString(entry.binding, "R2 binding"),
    bucketName: requiredString(
      entry.bucket_name,
      `R2 ${entry.binding} bucket_name`,
    ),
  }));
  return {
    schemaVersion: 1,
    adoptedAt,
    repository: requiredString(repository, "repository"),
    deploymentUrl: url.origin,
    worker: { name: resources.workerName },
    resources: {
      d1: {
        binding: resources.d1.binding,
        name: resources.databaseName,
        id: resources.databaseId,
      },
      kv: resources.kvEntries.map((entry) => ({
        binding: entry.binding,
        id: entry.id,
      })),
      queues: {
        producers: resources.producers.map((entry) => ({
          binding: requiredString(entry.binding, "Queue producer binding"),
          queue: requiredString(entry.queue, `Queue ${entry.binding} name`),
        })),
        consumers: resources.consumers.map((entry) => ({
          queue: requiredString(entry.queue, "Queue consumer name"),
          ...(entry.dead_letter_queue
            ? { deadLetterQueue: entry.dead_letter_queue }
            : {}),
        })),
      },
      r2,
    },
    upstream: validateUpstream(upstream),
  };
}

export function assertInstallationMatchesConfig(
  manifest,
  wrangler,
  r2Wrangler,
) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error("installation manifest schemaVersion 1 is required");
  }
  if (manifest.worker?.name !== wrangler?.name) {
    throw new Error("Worker name does not match the adopted installation");
  }
  const d1 = wrangler?.d1_databases?.find(
    (entry) => entry.binding === manifest.resources?.d1?.binding,
  );
  if (
    !d1 ||
    d1.database_name !== manifest.resources.d1.name ||
    d1.database_id !== manifest.resources.d1.id
  ) {
    throw new Error("D1 configuration does not match the adopted installation");
  }
  const kvByBinding = bindingMap(wrangler?.kv_namespaces);
  for (const adopted of manifest.resources?.kv ?? []) {
    if (kvByBinding.get(adopted.binding)?.id !== adopted.id) {
      throw new Error(
        `KV ${adopted.binding} does not match the adopted installation`,
      );
    }
  }
  const producers = bindingMap(wrangler?.queues?.producers);
  for (const adopted of manifest.resources?.queues?.producers ?? []) {
    if (producers.get(adopted.binding)?.queue !== adopted.queue) {
      throw new Error(
        `Queue ${adopted.binding} does not match the adopted installation`,
      );
    }
  }
  const consumers = new Map(
    (wrangler?.queues?.consumers ?? []).map((entry) => [entry.queue, entry]),
  );
  for (const adopted of manifest.resources?.queues?.consumers ?? []) {
    const configured = consumers.get(adopted.queue);
    if (
      !configured ||
      (configured.dead_letter_queue ?? undefined) !==
        (adopted.deadLetterQueue ?? undefined)
    ) {
      throw new Error(
        `Queue consumer ${adopted.queue} does not match the adopted installation`,
      );
    }
  }
  const adoptedR2 = manifest.resources?.r2 ?? [];
  if (adoptedR2.length > 0 && !r2Wrangler) {
    throw new Error(
      "R2 configuration is required for this adopted installation",
    );
  }
  if (adoptedR2.length > 0) {
    assertInstallationMatchesConfig(
      {
        ...manifest,
        resources: { ...manifest.resources, r2: [] },
      },
      r2Wrangler,
    );
  }
  const r2ByBinding = bindingMap(r2Wrangler?.r2_buckets);
  for (const adopted of adoptedR2) {
    if (r2ByBinding.get(adopted.binding)?.bucket_name !== adopted.bucketName) {
      throw new Error(
        `R2 ${adopted.binding} does not match the adopted installation`,
      );
    }
  }
}

export function assertProductionRepository(repository) {
  const normalized = requiredString(repository, "GITHUB_REPOSITORY");
  if (OFFICIAL_REPOSITORIES.has(normalized)) {
    throw new Error(
      "Production deployment is allowed only from an installation repository",
    );
  }
}

export function validateProductionSource({ ref, sha, remoteMainSha }) {
  if (ref !== "refs/heads/main") {
    throw new Error("Production deployment requires refs/heads/main");
  }
  if (!/^[0-9a-f]{40}$/u.test(sha ?? "")) {
    throw new Error("GITHUB_SHA must be a full Git commit SHA");
  }
  if (sha !== remoteMainSha) {
    throw new Error("Production source is not the remote main HEAD");
  }
}

export function mergeInstallationWrangler({ current, upstream }) {
  const currentProducers = bindingMap(current?.queues?.producers);
  const upstreamProducerBindings = new Set(
    (upstream?.queues?.producers ?? []).map((entry) => entry.binding),
  );
  const mergedProducers = [
    ...(upstream?.queues?.producers ?? []).map((entry) => ({
      ...entry,
      ...(currentProducers.get(entry.binding) ?? {}),
      binding: entry.binding,
    })),
    ...(current?.queues?.producers ?? [])
      .filter((entry) => !upstreamProducerBindings.has(entry.binding))
      .map((entry) => structuredClone(entry)),
  ];
  const currentQueueByUpstreamQueue = new Map();
  for (const upstreamProducer of upstream?.queues?.producers ?? []) {
    const currentProducer = currentProducers.get(upstreamProducer.binding);
    if (currentProducer) {
      currentQueueByUpstreamQueue.set(
        upstreamProducer.queue,
        currentProducer.queue,
      );
    }
  }
  const currentConsumers = new Map(
    (current?.queues?.consumers ?? []).map((entry) => [entry.queue, entry]),
  );
  const mergedConsumerQueues = new Set();
  const mergedConsumers = [
    ...(upstream?.queues?.consumers ?? []).map((entry) => {
      const installedQueue =
        currentQueueByUpstreamQueue.get(entry.queue) ?? entry.queue;
      mergedConsumerQueues.add(installedQueue);
      return {
        ...entry,
        ...(currentConsumers.get(installedQueue) ?? {}),
        queue: installedQueue,
      };
    }),
    ...(current?.queues?.consumers ?? [])
      .filter((entry) => !mergedConsumerQueues.has(entry.queue))
      .map((entry) => structuredClone(entry)),
  ];
  return {
    ...structuredClone(upstream),
    name: current?.name ?? upstream?.name,
    d1_databases: mergeBoundResources(
      current?.d1_databases,
      upstream?.d1_databases,
    ),
    kv_namespaces: mergeBoundResources(
      current?.kv_namespaces,
      upstream?.kv_namespaces,
    ),
    ...(upstream?.r2_buckets || current?.r2_buckets
      ? {
          r2_buckets: mergeBoundResources(
            current?.r2_buckets,
            upstream?.r2_buckets,
          ),
        }
      : {}),
    queues: {
      ...(upstream?.queues ?? {}),
      producers: mergedProducers,
      consumers: mergedConsumers,
    },
  };
}

export function mergeInstallationPackage({ current, upstream }) {
  return {
    ...structuredClone(upstream),
    name: current?.name ?? upstream?.name,
  };
}

export function isOfficialRepository(repository) {
  return OFFICIAL_REPOSITORIES.has(repository);
}
