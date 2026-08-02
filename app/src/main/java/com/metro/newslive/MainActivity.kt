package com.metro.newslive

import android.os.Bundle
import android.view.Window
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.viewpager2.widget.ViewPager2
import com.metro.newslive.adapter.PivotPagerAdapter

class MainActivity : AppCompatActivity() {

    private val categories = listOf("latest", "local", "entertainment", "tech", "pinned", "settings")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Full Immersive Mode (No Status Bar, No Top Logo / Time)
        enableFullscreenImmersive(window)

        setContentView(R.layout.activity_main)

        val tvPivotHeader = findViewById<TextView>(R.id.tvPivotHeader)
        val viewPager = findViewById<ViewPager2>(R.id.viewPagerPivot)

        val adapter = PivotPagerAdapter(this, categories)
        viewPager.adapter = adapter

        // Set initial position in middle of Int.MAX_VALUE for infinite loop
        val initialPos = (Int.MAX_VALUE / 2) - ((Int.MAX_VALUE / 2) % categories.size)
        viewPager.setCurrentItem(initialPos, false)

        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                val index = position % categories.size
                tvPivotHeader.text = categories[index]
            }
        })
    }

    private fun enableFullscreenImmersive(window: Window) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
