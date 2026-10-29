package app.hark.android.transport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.hark.android.HarkApp
import app.hark.android.data.InstantDelivery
import app.hark.android.work.HarkWorker
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Restarts instant delivery after reboot and after an app update (both are FGS-start exemptions). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val c = (context.applicationContext as HarkApp).container
        val pending = goAsync()
        c.scope.launch {
            try {
                val settings = c.settings.current()
                if (!settings.paired) return@launch
                // Start the service right away while the exemption applies when we already know it's wanted.
                val fcmPossible = FcmSupport.isConfigured(context)
                if (settings.instantDelivery == InstantDelivery.ON ||
                    (settings.instantDelivery == InstantDelivery.AUTO && !fcmPossible)
                ) {
                    SocketService.start(context)
                }
                if (withTimeoutOrNull(8_000) { c.transport.refresh() } == null) {
                    HarkWorker.enqueueRefreshTransport(context)
                }
                HarkWorker.enqueueSync(context)
            } finally {
                pending.finish()
            }
        }
    }
}
