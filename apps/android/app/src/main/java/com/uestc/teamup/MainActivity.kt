package com.uestc.teamup

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * UESTC TeamUp WebView 壳：
 * - 站内链接在 WebView 内打开（Cookie 会话与浏览器一致）
 * - 站外链接 / target=_blank / window.open / 下载（.ics、后台导出）交给系统浏览器
 * - 主框架加载失败时展示重试页
 */
class MainActivity : Activity() {

    companion object {
        private const val HOME_URL = "https://teamup.20050917.xyz/"
        private const val SITE_HOST = "teamup.20050917.xyz"
        private const val REQ_FILE_CHOOSER = 1001
    }

    private lateinit var webView: WebView
    private lateinit var errorView: LinearLayout
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = SiteWebViewClient()
            webChromeClient = SiteWebChromeClient()
            setDownloadListener { url, _, _, _, _ -> openExternally(url) }
        }
        CookieManager.getInstance().setAcceptCookie(true)

        errorView = buildErrorView()

        val root = FrameLayout(this).apply {
            // Android 15 (targetSdk 35) 强制边到边：由根布局消费系统栏内边距，
            // 保证站点页头不被状态栏遮挡；旧版本上无副作用。
            fitsSystemWindows = true
            addView(webView)
            addView(
                errorView,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        setContentView(root)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(HOME_URL)
        }
    }

    /** 站内留在 WebView，站外用系统浏览器打开 */
    private inner class SiteWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val host = request.url.host ?: return false
            return if (host == SITE_HOST || host.endsWith(".$SITE_HOST")) {
                false
            } else {
                openExternally(request.url.toString())
                true
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            // 只处理主框架失败；快速导航中的 ERR_ABORTED 属正常现象
            if (!request.isForMainFrame) return
            if (error.description?.toString()?.contains("net::ERR_ABORTED") == true) return
            showError()
        }
    }

    private inner class SiteWebChromeClient : WebChromeClient() {

        /** target=_blank / window.open（日历 .ics 订阅、后台导出）：交给系统浏览器 */
        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: Message,
        ): Boolean {
            val temp = WebView(view.context)
            temp.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    openExternally(request.url.toString())
                    return true
                }
            }
            val transport = resultMsg.obj as WebView.WebViewTransport
            transport.webView = temp
            resultMsg.sendToTarget()
            return true
        }

        /** 预留文件上传能力（当前站点无上传入口，未来增加时无需发版壳层） */
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = callback
            return try {
                startActivityForResult(fileChooserParams.createIntent(), REQ_FILE_CHOOSER)
                true
            } catch (_: ActivityNotFoundException) {
                filePathCallback = null
                false
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE_CHOOSER) {
            val callback = filePathCallback ?: return
            filePathCallback = null
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onPause() {
        if (this::webView.isInitialized) {
            webView.onPause()
            CookieManager.getInstance().flush()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (this::webView.isInitialized) webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (this::webView.isInitialized) webView.saveState(outState)
    }

    override fun onDestroy() {
        if (this::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private fun openExternally(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            // 没有可处理的应用时静默忽略
        }
    }

    private fun buildErrorView(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.WHITE)
        visibility = View.GONE

        val dp = { v: Int -> (v * resources.displayMetrics.density).toInt() }

        val title = TextView(this@MainActivity).apply {
            text = "网络连接失败"
            textSize = 18f
            setTextColor(Color.parseColor("#0a2e55"))
        }
        val hint = TextView(this@MainActivity).apply {
            text = "请检查网络后重试"
            textSize = 14f
            setTextColor(Color.GRAY)
        }
        val retry = Button(this@MainActivity).apply {
            text = "重试"
            setOnClickListener {
                errorView.visibility = View.GONE
                webView.visibility = View.VISIBLE
                webView.reload()
            }
        }

        addView(title)
        addView(hint)
        addView(
            retry,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(24) },
        )
        val pad = dp(32)
        setPadding(pad, pad, pad, pad)
    }

    private fun showError() {
        webView.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }
}
