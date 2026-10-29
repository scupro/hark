package app.hark.android

import app.hark.android.model.HarkJson
import app.hark.android.model.PairInput
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class PairInputTest {
    @Test
    fun `pair request always includes platform`() {
        val json = HarkJson.parseToJsonElement(
            HarkJson.encodeToString(PairInput.serializer(), PairInput("QVAUAGYD", "SM-S918B", "android")),
        ).jsonObject
        assertEquals("android", json["platform"]?.jsonPrimitive?.content)
        assertEquals("QVAUAGYD", json["code"]?.jsonPrimitive?.content)
        assertEquals("SM-S918B", json["name"]?.jsonPrimitive?.content)
    }
}
