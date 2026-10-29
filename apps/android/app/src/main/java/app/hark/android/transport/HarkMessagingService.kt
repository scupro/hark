package app.hark.android.transport

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.hark.android.HarkApp
import app.hark.android.data.HarkApiException
import app.hark.android.model.FcmMessage
import app.hark.android.work.HarkWorker
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** FCM data messages (protocol §7). Only ever invoked when Firebase was configured at build time. */
class HarkMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val msg = FcmMessage.parse(message.data) ?: return
        val c = (application as HarkApp).container
        if (runBlocking { c.settings.session() } == null) return // stale push for an unpaired device
        // onMessageReceived runs on a background thread with a ~20 s budget; blocking here is the intended model.
        runBlocking {
            try {
                withTimeout(15_000) {
                    if (msg.isDeleted) {
                        c.processor.onDeleted(msg.id)
                        return@withTimeout
                    }
                    val n = msg.notification ?: run {
                        val session = c.settings.session() ?: return@withTimeout
                        c.api.get(session, msg.id)
                    }
                    if (msg.isCreated) c.processor.onCreated(n) else c.processor.onUpdated(n, msg.alert)
                }
            } catch (e: HarkApiException) {
                if (e.isNotFound) c.processor.onDeleted(msg.id) else HarkWorker.enqueueSync(this@HarkMessagingService)
            } catch (e: Exception) {
                Log.w(TAG, "FCM handling failed for ${msg.id}; scheduling catch-up", e)
                HarkWorker.enqueueSync(this@HarkMessagingService)
            }
        }
    }

    /** Messages were dropped server-side (device offline too long): catch up over REST. */
    override fun onDeletedMessages() {
        HarkWorker.enqueueSync(this)
    }

    @Deprecated("Replaced by onRegistered in firebase-messaging 26; kept for the getToken() flow.")
    override fun onNewToken(token: String) = handleToken(token)

    override fun onRegistered(token: String) = handleToken(token)

    private fun handleToken(token: String) {
        Log.i(TAG, "New FCM token")
        val c = (application as HarkApp).container
        runBlocking {
            try {
                withTimeout(10_000) { c.transport.registerFcmToken(token) }
            } catch (e: Exception) {
                HarkWorker.enqueueRefreshTransport(this@HarkMessagingService)
            }
        }
    }

    private companion object {
        const val TAG = "HarkFcm"
    }
}
