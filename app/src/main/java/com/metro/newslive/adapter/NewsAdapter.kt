package com.metro.newslive.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.LinearSmoothScroller
import androidx.recyclerview.widget.RecyclerView
import com.metro.newslive.R
import com.metro.newslive.model.Article
import com.metro.newslive.ui.TileBackgroundView

class NewsAdapter(
    private var articles: List<Article>,
    private var accentColor: Int,
    private var fontSizeSp: Float
) : RecyclerView.Adapter<NewsAdapter.NewsViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): NewsViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_news_tile, parent, false)
        return NewsViewHolder(view)
    }

    override fun onBindViewHolder(holder: NewsViewHolder, position: Int) {
        val article = articles[position]
        holder.bind(article, accentColor, fontSizeSp) {
            article.isExpanded = !article.isExpanded
            notifyItemChanged(position)

            // Auto-snap to top upon expansion
            if (article.isExpanded) {
                val recyclerView = holder.itemView.parent as? RecyclerView
                recyclerView?.let { rv ->
                    val smoothScroller = object : LinearSmoothScroller(rv.context) {
                        override fun getVerticalSnapPreference(): Int = SNAP_TO_START
                    }
                    smoothScroller.targetPosition = position
                    rv.layoutManager?.startSmoothScroll(smoothScroller)
                }
            }
        }
    }

    override fun getItemCount(): Int = articles.size

    fun updateData(newArticles: List<Article>, newAccentColor: Int, newFontSizeSp: Float) {
        this.articles = newArticles
        this.accentColor = newAccentColor
        this.fontSizeSp = newFontSizeSp
        notifyDataSetChanged()
    }

    class NewsViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val bgView: TileBackgroundView = itemView.findViewById(R.id.tileBgView)
        private val tvTitle: TextView = itemView.findViewById(R.id.tvTileTitle)
        private val tvMeta: TextView = itemView.findViewById(R.id.tvTileMeta)
        private val tvSummary: TextView = itemView.findViewById(R.id.tvTileSummary)

        fun bind(article: Article, accentColor: Int, fontSizeSp: Float, onClick: () -> Unit) {
            tvTitle.text = article.title
            tvTitle.textSize = fontSizeSp
            tvMeta.text = "${article.source} • ${article.pubDate.take(16)}"
            tvSummary.text = article.summary
            tvSummary.visibility = if (article.isExpanded) View.VISIBLE else View.GONE

            // Seed based on article ID hashCode
            bgView.setupGeometry(article.id.hashCode().toLong(), accentColor)

            itemView.setOnClickListener { onClick() }
        }
    }
}
