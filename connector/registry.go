package main

import (
	"fmt"
	"log"

	"golang.org/x/sys/windows/registry"
)

// PST Chrome Extension ID (replace with your actual published extension ID)
// Format: Chrome Web Store ID, e.g. "abcdefghijklmnopqrstuvwxyz012345"
const (
	PST_EXTENSION_ID      = "PST_EXTENSION_PLACEHOLDER_ID"
	PST_EXTENSION_VERSION = "https://clients2.google.com/service/update2/crx"
)

// Browser registry paths for force-installing extensions
var browserExtensionKeys = []struct {
	Browser string
	Path    string
}{
	{
		Browser: "Google Chrome",
		Path:    `SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist`,
	},
	{
		Browser: "Microsoft Edge",
		Path:    `SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist`,
	},
}

// InjectExtension writes the PST extension to the Windows Registry so that
// Chrome and Edge will silently force-install it on next launch.
func InjectExtension() error {
	extValue := fmt.Sprintf("%s;%s", PST_EXTENSION_ID, PST_EXTENSION_VERSION)
	valueName := "1" // Registry value name (index)
	var lastErr error

	for _, browser := range browserExtensionKeys {
		key, _, err := registry.CreateKey(
			registry.LOCAL_MACHINE,
			browser.Path,
			registry.SET_VALUE,
		)
		if err != nil {
			log.Printf("[Registry] Could not open key for %s: %v", browser.Browser, err)
			lastErr = err
			continue
		}
		defer key.Close()

		if err := key.SetStringValue(valueName, extValue); err != nil {
			log.Printf("[Registry] Could not set value for %s: %v", browser.Browser, err)
			lastErr = err
			continue
		}

		log.Printf("[Registry] Successfully injected PST extension for %s", browser.Browser)
	}

	return lastErr
}

// RemoveExtension removes the PST extension from the Windows Registry.
// Call this during uninstallation.
func RemoveExtension() {
	for _, browser := range browserExtensionKeys {
		key, err := registry.OpenKey(
			registry.LOCAL_MACHINE,
			browser.Path,
			registry.SET_VALUE,
		)
		if err != nil {
			continue
		}
		key.DeleteValue("1")
		key.Close()
		log.Printf("[Registry] Removed PST extension for %s", browser.Browser)
	}
}
