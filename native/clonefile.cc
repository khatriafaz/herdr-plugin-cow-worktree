#include <node_api.h>
#include <cerrno>
#include <cstring>
#if COW_DARWIN
#include <sys/clonefile.h>
#endif

static napi_value CloneFile(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, nullptr, "cloneFile requires source and destination paths");
    return nullptr;
  }
  size_t source_len = 0, destination_len = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &source_len);
  napi_get_value_string_utf8(env, argv[1], nullptr, 0, &destination_len);
  char* source = new char[source_len + 1];
  char* destination = new char[destination_len + 1];
  napi_get_value_string_utf8(env, argv[0], source, source_len + 1, &source_len);
  napi_get_value_string_utf8(env, argv[1], destination, destination_len + 1, &destination_len);
#if COW_DARWIN
  int result = clonefile(source, destination, 0);
  int saved_errno = errno;
#else
  int result = -1;
  int saved_errno = ENOTSUP;
#endif
  delete[] source;
  delete[] destination;
  if (result != 0) {
    napi_value message;
    napi_create_string_utf8(env, std::strerror(saved_errno), NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, nullptr, message, &error);
    napi_value code;
    napi_create_int32(env, saved_errno, &code);
    napi_set_named_property(env, error, "errno", code);
    napi_throw(env, error);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "cloneFile", NAPI_AUTO_LENGTH, CloneFile, nullptr, &fn);
  napi_set_named_property(env, exports, "cloneFile", fn);
  return exports;
}
