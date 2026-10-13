#include <node_api.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef void (*qm_callback)(void *ctx, const char *json, const char *error);
typedef void (*qm_import)(const char *token, void *ctx, qm_callback callback);

static qm_import qm_import_passwords;

typedef struct {
  napi_threadsafe_function tsfn;
} Call;

typedef struct {
  char *json;
  char *error;
} Result;

static void call_js(napi_env env, napi_value js_callback, void *context, void *data) {
  Result *result = data;
  napi_value receiver;
  napi_value args[2];
  napi_value unused;
  (void)context;
  napi_get_undefined(env, &receiver);
  if (result != NULL && result->error != NULL)
    napi_create_string_utf8(env, result->error, NAPI_AUTO_LENGTH, &args[0]);
  else napi_get_null(env, &args[0]);
  if (result != NULL && result->json != NULL)
    napi_create_string_utf8(env, result->json, NAPI_AUTO_LENGTH, &args[1]);
  else napi_get_null(env, &args[1]);
  if (js_callback != NULL) napi_call_function(env, receiver, js_callback, 2, args, &unused);
  if (result != NULL) {
    free(result->json);
    free(result->error);
    free(result);
  }
}

static void on_import(void *ctx, const char *json, const char *error) {
  Call *call = ctx;
  Result *result = calloc(1, sizeof(*result));
  if (result != NULL) {
    if (json != NULL) result->json = strdup(json);
    if (error != NULL) result->error = strdup(error);
  }
  if (call != NULL) {
    napi_call_threadsafe_function(call->tsfn, result, napi_tsfn_blocking);
    napi_release_threadsafe_function(call->tsfn, napi_tsfn_release);
    free(call);
  } else {
    free(result);
  }
}

static int load_library(void) {
  Dl_info info;
  char path[4096];
  const char *slash;
  size_t dir;
  void *lib;
  if (qm_import_passwords != NULL) return 1;
  if (dladdr((void *)load_library, &info) == 0 || info.dli_fname == NULL) return 0;
  slash = strrchr(info.dli_fname, '/');
  if (slash == NULL) return 0;
  dir = (size_t)(slash - info.dli_fname);
  if (dir + 32 >= sizeof(path)) return 0;
  memcpy(path, info.dli_fname, dir);
  snprintf(path + dir, sizeof(path) - dir, "/libQMPasswordImport.dylib");
  lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (lib == NULL) return 0;
  qm_import_passwords = (qm_import)dlsym(lib, "qm_import_passwords");
  return qm_import_passwords != NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_valuetype callback_type;
  size_t len = 0;
  char *token;
  Call *call;
  napi_value name;
  napi_value undef;
  napi_status status;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 2 || load_library() == 0) {
    napi_throw_error(env, NULL, "Password import is not available in this copy of QM.");
    return NULL;
  }
  napi_typeof(env, args[1], &callback_type);
  if (callback_type != napi_function) {
    napi_throw_type_error(env, NULL, "Password import is not available in this copy of QM.");
    return NULL;
  }
  napi_get_value_string_utf8(env, args[0], NULL, 0, &len);
  token = malloc(len + 1);
  call = calloc(1, sizeof(*call));
  if (token == NULL || call == NULL) {
    free(token);
    free(call);
    napi_throw_error(env, NULL, "Password import is not available in this copy of QM.");
    return NULL;
  }
  napi_get_value_string_utf8(env, args[0], token, len + 1, &len);
  napi_create_string_utf8(env, "qm-password-import", NAPI_AUTO_LENGTH, &name);
  status = napi_create_threadsafe_function(
    env, args[1], NULL, name, 0, 1, NULL, NULL, NULL, call_js, &call->tsfn
  );
  if (status != napi_ok) {
    free(token);
    free(call);
    napi_throw_error(env, NULL, "Password import is not available in this copy of QM.");
    return NULL;
  }
  qm_import_passwords(token, call, on_import);
  free(token);
  napi_get_undefined(env, &undef);
  return undef;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  return exports;
}
