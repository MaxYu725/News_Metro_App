package com.metro.newslive.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import kotlin.random.Random

/**
 * TileBackgroundView: Draws random seed-based geometry anchored at origin (0,0).
 * When the parent Tile view expands, the geometric canvas is un-clipped smoothly
 * without shifting or scaling the pattern.
 */
class TileBackgroundView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private val paths = mutableListOf<Path>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    private var currentSeed: Long = 0
    private var currentAccentColor: Int = 0xFF00AB10.toInt() // Metro Green default

    fun setupGeometry(seed: Long, accentColor: Int) {
        if (currentSeed == seed && currentAccentColor == accentColor && paths.isNotEmpty()) return
        currentSeed = seed
        currentAccentColor = accentColor

        paths.clear()
        val random = Random(seed)
        val density = resources.displayMetrics.density
        
        // Fixed absolute bounds anchored at origin
        val maxWidthPx = 800 * density
        val maxHeightPx = 1800 * density

        val polygonCount = random.nextInt(3, 6)
        for (i in 0 until polygonCount) {
            val path = Path()
            val startX = random.nextFloat() * maxWidthPx
            val startY = random.nextFloat() * maxHeightPx
            path.moveTo(startX, startY)

            val pointCount = random.nextInt(3, 5)
            for (j in 1 until pointCount) {
                path.lineTo(random.nextFloat() * maxWidthPx, random.nextFloat() * maxHeightPx)
            }
            path.close()
            paths.add(path)
        }

        paint.color = accentColor
        paint.alpha = random.nextInt(25, 55) // 10% - 20% translucency
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        // Canvas is drawn with fixed origin (0,0), un-clipping geometry when expanded
        paths.forEach { path ->
            canvas.drawPath(path, paint)
        }
    }
}
