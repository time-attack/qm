import AuthenticationServices
import Cocoa

@objc(QMCredentialProviderViewController)
public class QMCredentialProviderViewController: ASCredentialProviderViewController {
  public override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    extensionContext.cancelRequest(
      withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.Code.userCanceled.rawValue),
    )
  }

  public override func prepareCredentialList(
    for serviceIdentifiers: [ASCredentialServiceIdentifier],
    requestParameters: ASPasskeyCredentialRequestParameters,
  ) {
    extensionContext.cancelRequest(
      withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.Code.userCanceled.rawValue),
    )
  }

  public override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    extensionContext.cancelRequest(
      withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.Code.userCanceled.rawValue),
    )
  }
}
