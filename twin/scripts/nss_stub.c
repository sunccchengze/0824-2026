/* NSS/NSPR 最小桩库（仅供沙箱无头 Chromium / SwiftShader 加载，无真实 SSL/TLS）。
 * 这是可复现版本：bootstrap.sh 用它生成 libnspr4.so / libnss3.so / libnssutil3.so 到 /tmp/nsslibs。
 */
#include <stddef.h>
#include <stdint.h>

/* CERT */
void *CERT_CreateSubjectCertList(void *a, void *b, void *c, void *d) { (void)a;(void)b;(void)c;(void)d; return 0; }
void CERT_DestroyCertList(void *p) { (void)p; }
void CERT_DestroyCertificate(void *p) { (void)p; }
void *CERT_DupCertificate(void *p) { return p; }
void *CERT_FindCertByDERCert(void *a, void *b) { (void)a;(void)b; return 0; }
int CERT_GetCertTrust(void *a, void *b) { (void)a;(void)b; return -1; }
void *CERT_GetDefaultCertDB(void) { return 0; }
int CERT_IsUserCert(void *p) { (void)p; return 0; }

/* NSS */
int NSS_InitReadWrite(const char *d) { (void)d; return 0; }
int NSS_NoDB_Init(const char *d) { (void)d; return 0; }
int NSS_SetAlgorithmPolicy(void *a, void *b, void *c, void *d) { (void)a;(void)b;(void)c;(void)d; return 0; }
int NSS_VersionCheck(const char *v) { (void)v; return 1; }

/* PK11 */
void PK11_DestroyGenericObjects(void *p) { (void)p; }
void *PK11_FindCertInSlot(void *a, void *b, void *c) { (void)a;(void)b;(void)c; return 0; }
void *PK11_FindGenericObjects(void *a, void *b) { (void)a;(void)b; return 0; }
void PK11_FreeSlot(void *p) { (void)p; }
void *PK11_GetInternalKeySlot(void *p) { (void)p; return 0; }
void *PK11_GetModule(void *p) { (void)p; return 0; }
void *PK11_GetNextGenericObject(void *a, void *b, void *c, void *d) { (void)a;(void)b;(void)c;(void)d; return 0; }
const char *PK11_GetTokenName(void *p) { (void)p; return ""; }
int PK11_HasAttributeSet(void *a, void *b, void *c) { (void)a;(void)b;(void)c; return 0; }
int PK11_HasRootCerts(void *p) { (void)p; return 0; }
int PK11_InitPin(void *a, const char *b, const char *c, void *d) { (void)a;(void)b;(void)c;(void)d; return -1; }
int PK11_IsPresent(void *p) { (void)p; return 0; }
void *PK11_ListCerts(void *a, void *b, void *c, void *d, void *e) { (void)a;(void)b;(void)c;(void)d;(void)e; return 0; }
void *PK11_ListCertsInSlot(void *a, void *b, void *c, void *d) { (void)a;(void)b;(void)c;(void)d; return 0; }
int PK11_NeedUserInit(void *p) { (void)p; return 0; }
int PK11_ReadRawAttribute(void *a, void *b, void *c, void *d, void *e) { (void)a;(void)b;(void)c;(void)d;(void)e; return -1; }
void *PK11_ReferenceSlot(void *p) { return p; }
int PK11_SetPasswordFunc(void *p) { (void)p; return 0; }

/* SECITEM */
void *SECITEM_AllocItem(void *a, void *b, unsigned int c) { (void)a;(void)b;(void)c; return 0; }
void SECITEM_FreeItem(void *a, int b) { (void)a;(void)b; }

/* SECMOD */
void SECMOD_DestroyModule(void *p) { (void)p; }
void *SECMOD_GetDefaultModuleList(void) { return 0; }
void *SECMOD_GetDefaultModuleListLock(void) { return 0; }
void *SECMOD_GetReadLock(void) { return 0; }
void *SECMOD_LoadUserModule(void *a, void *b, int c) { (void)a;(void)b;(void)c; return 0; }
void SECMOD_ReleaseReadLock(void *p) { (void)p; }

/* PR (NSPR) */
int PR_GetError(void) { return 0; }
const char *PR_GetErrorText(void) { return ""; }
int PR_GetErrorTextLength(void) { return 0; }
int PR_GetOSError(void) { return 0; }
void PR_Init(void *a, void *b, int c) { (void)a;(void)b;(void)c; }
uint64_t PR_Now(void) { return 0; }
