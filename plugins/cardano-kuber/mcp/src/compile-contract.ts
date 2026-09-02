import type { Blueprint, ScriptArtifactPayload } from "@kuber/script-artifact";
import {
	AikenCompilerUnavailableError,
	type CompilerDiagnostic,
	CompilerUnavailableError,
	compileAiken,
	compilePlutus,
	diagnosticsFromLog,
} from "@kuber/compiler-client";
import {
	type MeshJsScript,
	type MeshJsValidation,
	validateForMeshJs,
} from "./meshjs.ts";

export type CompileLanguage = "aiken" | "plutus";

export interface CompileContractInput {
	language?: CompileLanguage;
	files: Record<string, string>;
	/** Selects the Haskell file when a Plutus project contains more than one file. */
	title?: string;
}

export interface CompileContractOptions {
	compilerUrl?: string;
	plutusCompilerUrl?: string;
	plutusApiKey?: string;
	networkId?: number;
	signal?: AbortSignal;
}

export type CompileScriptStatus = "ready" | "invalid" | "parameterized";

export interface CompileContractScript extends ScriptArtifactPayload {
	status: CompileScriptStatus;
	parameterized: boolean;
	diagnostics: CompilerDiagnostic[];
	meshjs?: MeshJsScript;
	validation?: MeshJsValidation;
}

export interface CompileContractSuccess {
	status: "ready" | "partial";
	language: CompileLanguage;
	nativeArtifact: Blueprint | PlutusNativeArtifact;
	scripts: CompileContractScript[];
	diagnostics: CompilerDiagnostic[];
}

export interface CompileContractFailure {
	status: "invalid" | "unavailable";
	language: CompileLanguage;
	diagnostics: CompilerDiagnostic[];
}

export type CompileContractResult =
	| CompileContractSuccess
	| CompileContractFailure;

export interface PlutusNativeArtifact {
	type: string;
	cborHex: string;
	description?: string;
}

/** Compile Aiken or Plutus source and return native and MeshJS-ready artifacts. */
export async function compileContract(
	input: CompileContractInput,
	opts: CompileContractOptions,
): Promise<CompileContractResult> {
	const language = input.language ?? "aiken";
	return language === "aiken"
		? compileAikenContract(input.files, opts)
		: compilePlutusContract(input.files, input.title, opts);
}

async function compileAikenContract(
	files: Record<string, string>,
	opts: CompileContractOptions,
): Promise<CompileContractResult> {
	// Aiken compiles a project, not a single validator file. Rejecting the missing
	// manifest here gives the caller a useful error without spending a compiler slot.
	if (!("aiken.toml" in files)) {
		return invalid(
			"aiken",
			"files must include aiken.toml at the project root",
			"missing_manifest",
		);
	}
	if (!opts.compilerUrl) {
		return unavailable(
			"aiken",
			"the Aiken compiler URL is not configured on the MCP host",
			"compiler_url_unavailable",
		);
	}

	let result: Awaited<ReturnType<typeof compileAiken>>;
	try {
		result = await compileAiken(files, {
			compilerUrl: opts.compilerUrl,
			...(opts.signal ? { signal: opts.signal } : {}),
		});
	} catch (error) {
		if (error instanceof AikenCompilerUnavailableError) {
			return unavailable("aiken", error.message, "compiler_unavailable");
		}
		throw error;
	}

	if (!result.ok) {
		return {
			status: "invalid",
			language: "aiken",
			diagnostics: diagnosticsFromLog(result.logs, result.reason),
		};
	}
	if (result.artifacts.length === 0) {
		return invalid(
			"aiken",
			"the build succeeded but produced no validators",
			"no_validators",
		);
	}

	return success(
		"aiken",
		result.blueprint,
		result.artifacts.map((artifact) =>
			decorateArtifact(artifact, opts.networkId ?? 0),
		),
	);
}

async function compilePlutusContract(
	files: Record<string, string>,
	title: string | undefined,
	opts: CompileContractOptions,
): Promise<CompileContractResult> {
	const candidates = Object.keys(files).filter((file) =>
		file.toLowerCase().endsWith(".hs"),
	);
	// title chooses one source value; the hosted compiler does not build the other
	// entries as Haskell modules.
	const sourceTitle =
		title ?? (candidates.length === 1 ? candidates[0] : undefined);
	if (!sourceTitle || !(sourceTitle in files)) {
		return invalid(
			"plutus",
			candidates.length === 0
				? "Plutus compilation requires one .hs source file in files"
				: "Plutus compilation requires title when files contains multiple .hs sources",
			"missing_source",
		);
	}
	if (!opts.plutusCompilerUrl) {
		return unavailable(
			"plutus",
			"the Plutus compiler URL is not configured on the MCP host",
			"compiler_url_unavailable",
		);
	}
	if (!opts.plutusApiKey) {
		return unavailable(
			"plutus",
			"the Plutus compiler API key is not configured on the MCP host",
			"credentials_unavailable",
		);
	}

	let result: Awaited<ReturnType<typeof compilePlutus>>;
	try {
		result = await compilePlutus(files[sourceTitle] ?? "", sourceTitle, {
			compilerUrl: opts.plutusCompilerUrl,
			apiKey: opts.plutusApiKey,
			...(opts.signal ? { signal: opts.signal } : {}),
		});
	} catch (error) {
		if (error instanceof CompilerUnavailableError) {
			return unavailable("plutus", error.message, "compiler_unavailable");
		}
		throw error;
	}

	if (!result.ok) {
		return {
			status: "invalid",
			language: "plutus",
			diagnostics: diagnosticsFromLog(result.log, "compile_failed"),
		};
	}
	// Keep the compiler's TextEnvelope alongside the normalized script. Some Cardano
	// libraries consume this shape directly, while MeshJS uses the decorated result below.
	const nativeArtifact: PlutusNativeArtifact = {
		type: result.script.type,
		cborHex: result.script.cborHex,
		...(result.script.description
			? { description: result.script.description }
			: {}),
	};
	return success("plutus", nativeArtifact, [
		decorateArtifact(
			result.artifact,
			opts.networkId ?? 0,
			true,
			result.script.cborHex,
		),
	]);
}

/**
 * Add deployability information to a compiler artifact.
 *
 * A script is ready only when its Plutus version is known, it has no unapplied
 * parameters, and MeshJS derives the same hash as the compiler.
 */
function decorateArtifact(
	artifact: ScriptArtifactPayload,
	networkId: number,
	fullEnvelope = false,
	fullEnvelopeCode?: string,
): CompileContractScript {
	if (!artifact.plutusVersion) {
		return {
			...artifact,
			status: "invalid",
			parameterized: false,
			diagnostics: [
				{
					severity: "error",
					code: "unknown_plutus_version",
					message:
						"The compiler output did not identify a supported Plutus version.",
				},
			],
		};
	}
	// Applying a parameter changes the script bytes and hash. Validating the template
	// here would produce a plausible address that cannot be used on chain.
	if (artifact.parameters.length > 0) {
		return {
			...artifact,
			status: "parameterized",
			parameterized: true,
			diagnostics: [
				{
					severity: "warning",
					code: "parameters_required",
					message:
						"This script is parameterized; apply its parameters before using it as a deployable MeshJS script.",
				},
			],
		};
	}

	const validation = validateForMeshJs(
		fullEnvelopeCode ?? artifact.compiledCode,
		artifact.plutusVersion,
		artifact.hash,
		networkId,
		fullEnvelope,
	);
	if (validation.validation.status === "valid") {
		return {
			...artifact,
			status: "ready",
			parameterized: false,
			diagnostics: [],
			meshjs: validation.script,
			validation: validation.validation,
		};
	}

	const code = validation.validation.meshjsDerivedHash
		? "hash_mismatch"
		: "meshjs_validation";
	return {
		...artifact,
		status: "invalid",
		parameterized: false,
		diagnostics: [
			{
				severity: "error",
				code,
				message:
					validation.validation.message ??
					`MeshJS hash ${validation.validation.meshjsDerivedHash ?? "unknown"} did not match ${artifact.hash}`,
			},
		],
		meshjs: validation.script,
		validation: validation.validation,
	};
}

function success(
	language: CompileLanguage,
	nativeArtifact: Blueprint | PlutusNativeArtifact,
	scripts: CompileContractScript[],
): CompileContractSuccess {
	const diagnostics = scripts.flatMap((script) => script.diagnostics);
	return {
		// A successful compiler build can still contain templates or a script whose
		// normalized bytes failed validation, so it is only partially ready.
		status: scripts.every((script) => script.status === "ready")
			? "ready"
			: "partial",
		language,
		nativeArtifact,
		scripts,
		diagnostics,
	};
}

function invalid(
	language: CompileLanguage,
	message: string,
	code: string,
): CompileContractFailure {
	return {
		status: "invalid",
		language,
		diagnostics: [{ severity: "error", code, message }],
	};
}

function unavailable(
	language: CompileLanguage,
	message: string,
	code: string,
): CompileContractFailure {
	return {
		status: "unavailable",
		language,
		diagnostics: [{ severity: "error", code, message }],
	};
}
