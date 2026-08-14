/*
 * porcupine-sandbox.exe — restricted-token write-fence helper (Windows)
 *
 * REFERENCE IMPLEMENTATION — NOT COMPILED OR VERIFIED (authored on macOS).
 * Build on Windows and verify behavior before shipping. Until this helper is
 * built and on PATH, the Node backend falls back to the native shell.
 *
 * Build (x64, MSVC):
 *   cl /O2 /Fe:porcupine-sandbox.exe porcupine-sandbox.c advapi32.lib
 *
 * Contract (invoked by src/core/sandbox/windows.ts):
 *   porcupine-sandbox.exe [--read-only] --workspace <dir> [--write <dir>]... -- <command> [args...]
 *   porcupine-sandbox.exe --probe   (exits 0 when runnable)
 *
 * Mechanism: create a WRITE_RESTRICTED token (CreateRestrictedToken with a
 * restricted SID), grant that SID GENERIC_WRITE on the allowed directories via
 * inherited ACEs, then CreateProcessAsUser. Windows then requires BOTH the
 * full-token and restricted-token SID lists to grant write access, so writes
 * outside the allowed dirs are denied even though the parent token can write.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <aclapi.h>
#include <stdio.h>
#include <wchar.h>

static void die(const wchar_t *msg) {
	fwprintf(stderr, L"porcupine-sandbox: %s (error %lu)\n", msg, GetLastError());
	ExitProcess(1);
}

/* Add an inherited allow ACE for `sid` (GENERIC_WRITE) to `path`'s DACL. */
static void grant_write(const wchar_t *path, PSID sid) {
	PSECURITY_DESCRIPTOR sd = NULL;
	PACL dacl = NULL;
	DWORD rc = GetNamedSecurityInfoW(
		path, SE_FILE_OBJECT,
		DACL_SECURITY_INFORMATION | UNPROTECTED_DACL_SECURITY_INFORMATION,
		NULL, NULL, &dacl, NULL, &sd);
	if (rc != ERROR_SUCCESS) die(L"GetNamedSecurityInfoW");

	EXPLICIT_ACCESSW ea = {0};
	ea.grfAccessPermissions = FILE_GENERIC_WRITE;
	ea.grfAccessMode = GRANT_ACCESS;
	ea.grfInheritance = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
	ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
	ea.Trustee.ptstrName = (LPWSTR)sid;

	PACL newDacl = NULL;
	rc = SetEntriesInAclW(1, &ea, dacl, &newDacl);
	if (rc != ERROR_SUCCESS) die(L"SetEntriesInAclW");

	rc = SetNamedSecurityInfoW(
		(PWSTR)path, SE_FILE_OBJECT,
		DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
		NULL, NULL, newDacl, NULL);
	if (rc != ERROR_SUCCESS) die(L"SetNamedSecurityInfoW");

	LocalFree(newDacl);
	LocalFree(sd);
}

int wmain(int argc, wchar_t **argv) {
	int probe = 0, readOnly = 0;
	wchar_t *workspace = NULL;
	wchar_t *writeDirs[64];
	int writeCount = 0;
	int sep = -1;

	for (int i = 1; i < argc; i++) {
		if (wcscmp(argv[i], L"--probe") == 0) { probe = 1; continue; }
		if (wcscmp(argv[i], L"--read-only") == 0) { readOnly = 1; continue; }
		if (wcscmp(argv[i], L"--workspace") == 0 && i + 1 < argc) { workspace = argv[++i]; continue; }
		if (wcscmp(argv[i], L"--write") == 0 && i + 1 < argc) {
			if (writeCount < 64) writeDirs[writeCount++] = argv[++i];
			continue;
		}
		if (wcscmp(argv[i], L"--") == 0) { sep = i; break; }
	}

	if (probe) return 0;
	if (sep < 0 || sep + 1 >= argc || workspace == NULL) {
		fwprintf(stderr, L"usage: porcupine-sandbox.exe [--read-only] --workspace <dir> [--write <dir>]... -- <cmd> [args...]\n");
		return 64;
	}

	/* 1. Restricted token: disable max privilege + add a restricted SID. */
	HANDLE hProc = GetCurrentProcess();
	HANDLE hToken = NULL;
	if (!OpenProcessToken(hProc, TOKEN_ALL_ACCESS, &hToken)) die(L"OpenProcessToken");

	PSID restrictedSid = NULL;
	SID_IDENTIFIER_AUTHORITY ntAuth = SECURITY_NT_AUTHORITY;
	if (!AllocateAndInitializeSid(&ntAuth, 1, SECURITY_RESTRICTED_CODE_RID, 0, 0, 0, 0, 0, 0, 0, &restrictedSid))
		die(L"AllocateAndInitializeSid");

	HANDLE hRestricted = NULL;
	if (!CreateRestrictedToken(hToken, DISABLE_MAX_PRIVILEGE, 0, NULL, 0, NULL, 1, &restrictedSid, &hRestricted))
		die(L"CreateRestrictedToken");

	/* 2. Grant the restricted SID write on the allowed directories. */
	if (!readOnly) {
		grant_write(workspace, restrictedSid);
		for (int i = 0; i < writeCount; i++) grant_write(writeDirs[i], restrictedSid);
	}

	/* 3. Build the command line (append all argv after `--`). */
	wchar_t cmdline[32768] = {0};
	for (int i = sep + 1; i < argc; i++) {
		wcscat_s(cmdline, sizeof(cmdline) / sizeof(wchar_t), argv[i]);
		if (i + 1 < argc) wcscat_s(cmdline, sizeof(cmdline) / sizeof(wchar_t), L" ");
	}

	/* 4. Launch the command under the restricted token. */
	STARTUPINFOW si = {0};
	si.cb = sizeof(si);
	PROCESS_INFORMATION pi = {0};
	if (!CreateProcessAsUserW(hRestricted, NULL, cmdline, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi))
		die(L"CreateProcessAsUserW");

	CloseHandle(pi.hThread);
	WaitForSingleObject(pi.hProcess, INFINITE);
	DWORD code = 1;
	GetExitCodeProcess(pi.hProcess, &code);
	CloseHandle(pi.hProcess);
	CloseHandle(hRestricted);
	CloseHandle(hToken);
	FreeSid(restrictedSid);
	return (int)code;
}
