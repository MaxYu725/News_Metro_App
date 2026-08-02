package com.metro.newslive.adapter

import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.adapter.FragmentStateAdapter
import com.metro.newslive.ui.fragment.NewsCategoryFragment
import com.metro.newslive.ui.fragment.SettingsFragment

class PivotPagerAdapter(
    activity: FragmentActivity,
    val categories: List<String>
) : FragmentStateAdapter(activity) {

    override fun getItemCount(): Int = Int.MAX_VALUE // Infinite Looping

    override fun createFragment(position: Int): Fragment {
        val index = position % categories.size
        val categoryKey = categories[index]

        return if (categoryKey == "settings") {
            SettingsFragment()
        } else {
            NewsCategoryFragment.newInstance(categoryKey)
        }
    }
}
