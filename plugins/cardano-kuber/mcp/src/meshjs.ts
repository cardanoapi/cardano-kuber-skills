import type { PlutusVersion } from "@kuber/script-artifact";
import { toTextEnvelope } from "@kuber/script-artifact";
import {
	type PlutusScript,
	resolvePlutusScriptAddress,
	resolvePlutusScriptHash,
} from "@meshsdk/core";

export interface MeshJsScript {
	code: string;
	version: Uppercase<PlutusVersion>;
	format: "meshjs";
}

export interface MeshJsValidation {
	status: "valid" | "invalid";
	hashMatch: boolean;
	canonicalHash: string;
	meshjsDerivedHash?: string;
	address?: string;
	networkId: number;
	message?: string;
}

export interface MeshJsResult {
	script: MeshJsScript;
	validation: MeshJsValidation;
}

/**
 * Build the exact script shape MeshJS expects, then compare its derived hash with the
 * compiler hash. Aiken supplies inner bytes that need one wrapper; Plutus supplies an
 * already wrapped TextEnvelope and sets fullEnvelope.
 */
export function validateForMeshJs(
	compiledCode: string,
	version: PlutusVersion,
	canonicalHash: string,
	networkId: number,
	fullEnvelope = false,
): MeshJsResult {
	const envelope = fullEnvelope ? null : toTextEnvelope(compiledCode, version);
	const code = fullEnvelope
		? compiledCode.trim().toLowerCase()
		: envelope?.cborHex;
	if (!code) {
		return invalidResult(
			compiledCode,
			version,
			canonicalHash,
			networkId,
			"could not create a MeshJS CBOR envelope",
		);
	}

	const script: MeshJsScript = {
		code,
		version: version.toUpperCase() as Uppercase<PlutusVersion>,
		format: "meshjs",
	};

	try {
		const meshScript: PlutusScript = {
			code: script.code,
			version: script.version,
		};
		const address = resolvePlutusScriptAddress(meshScript, networkId);
		const meshjsDerivedHash = resolvePlutusScriptHash(address).toLowerCase();
		const expected = canonicalHash.trim().toLowerCase();
		const hashMatch = expected === meshjsDerivedHash;
		return {
			script,
			validation: {
				status: hashMatch ? "valid" : "invalid",
				hashMatch,
				canonicalHash: expected,
				meshjsDerivedHash,
				address,
				networkId,
				...(hashMatch
					? {}
					: { message: "MeshJS derived a different script hash" }),
			},
		};
	} catch (error) {
		return invalidResult(
			compiledCode,
			version,
			canonicalHash,
			networkId,
			error instanceof Error ? error.message : String(error),
		);
	}
}

function invalidResult(
	compiledCode: string,
	version: PlutusVersion,
	canonicalHash: string,
	networkId: number,
	message: string,
): MeshJsResult {
	// Return the best available script representation with the error. It is useful for
	// diagnosis, but validation.status keeps callers from treating it as deployable.
	const envelope = toTextEnvelope(compiledCode, version);
	return {
		script: {
			code: envelope?.cborHex ?? compiledCode.trim().toLowerCase(),
			version: version.toUpperCase() as Uppercase<PlutusVersion>,
			format: "meshjs",
		},
		validation: {
			status: "invalid",
			hashMatch: false,
			canonicalHash: canonicalHash.trim().toLowerCase(),
			networkId,
			message,
		},
	};
}
