package com.metro.newslive.ui.fragment

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.metro.newslive.R
import com.metro.newslive.adapter.NewsAdapter
import com.metro.newslive.model.Article

class NewsCategoryFragment : Fragment() {

    private lateinit var recyclerView: RecyclerView
    private lateinit var adapter: NewsAdapter
    private var category: String = "latest"

    companion object {
        fun newInstance(category: String): NewsCategoryFragment {
            val fragment = NewsCategoryFragment()
            val args = Bundle()
            args.putString("category", category)
            fragment.arguments = args
            return fragment
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        category = arguments?.getString("category") ?: "latest"
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_news_category, container, false)
        recyclerView = view.findViewById(R.id.rvNewsTiles)
        recyclerView.layoutManager = LinearLayoutManager(context)

        // Sample articles with Worker URL fallback
        val mockArticles = listOf(
            Article("art_1", "陳茂波：上半年經濟增長5.1% 將向上調整全年預測", "財政司司長陳茂波發表網誌表示，本港經濟總體維持平穩...", "RTHK", category, "2026-08-02 12:52", "https://news.rthk.hk"),
            Article("art_2", "天文台今發出特別天氣通告 提醒市民留意最新狂風雷暴", "受廣闊低壓槽影響，本港今明兩日天氣持續不穩定...", "HKO", category, "2026-08-02 11:30", "https://www.hko.gov.hk"),
            Article("art_3", "最新娛樂特輯：夏季音樂節門票今日起公開發售", "今年夏季大型音樂娛樂展覽將於本月底開幕...", "MingPao", category, "2026-08-02 10:15", "https://news.mingpao.com")
        )

        adapter = NewsAdapter(mockArticles, 0xFF00AB10.toInt(), 18f)
        recyclerView.adapter = adapter
        return view
    }
}
