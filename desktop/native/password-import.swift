import AuthenticationServices
import Foundation

struct ExportedPassword: Encodable {
  let title: String
  let username: String
  let password: String
  let url: String?
}

func exportedPasswords(_ data: ASExportedCredentialData) -> [ExportedPassword] {
  var passwords: [ExportedPassword] = []
  for account in data.accounts {
    for item in account.items {
      let url = item.scope?.urls.first { $0.scheme == "https" || $0.scheme == "http" }?.absoluteString
      for credential in item.credentials {
        switch credential {
        case .basicAuthentication(let auth):
          guard let password = auth.password?.value, !password.isEmpty else { continue }
          passwords.append(
            ExportedPassword(title: item.title, username: auth.userName?.value ?? "", password: password, url: url),
          )
        case .generatedPassword(let generated):
          guard !generated.password.isEmpty else { continue }
          passwords.append(ExportedPassword(title: item.title, username: "", password: generated.password, url: url))
        default:
          continue
        }
      }
    }
  }
  return passwords
}

@_cdecl("qm_import_passwords")
public func qmImportPasswords(
  _ token: UnsafePointer<CChar>?,
  _ ctx: UnsafeMutableRawPointer?,
  _ callback: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Void
) {
  guard let token, let uuid = UUID(uuidString: String(cString: token)) else {
    "The Passwords export token was not valid.".withCString { callback(ctx, nil, $0) }
    return
  }
  Task {
    do {
      let data = try await ASCredentialImportManager().importCredentials(token: uuid)
      let json = try JSONEncoder().encode(exportedPasswords(data))
      guard let text = String(data: json, encoding: .utf8) else {
        "Passwords could not be read.".withCString { callback(ctx, nil, $0) }
        return
      }
      text.withCString { callback(ctx, $0, nil) }
    } catch {
      let ns = error as NSError
      "Passwords could not be imported (\(ns.domain) \(ns.code)).".withCString { callback(ctx, nil, $0) }
    }
  }
}
