package app.hark.android.model

import kotlinx.serialization.json.Json

/** The one Json instance used for the Hark protocol. */
val HarkJson: Json = Json {
    ignoreUnknownKeys = true
    // Unknown enum values (e.g. a future severity) and explicit nulls for non-null fields fall back to defaults.
    coerceInputValues = true
    isLenient = false
    explicitNulls = false
    encodeDefaults = false
}
